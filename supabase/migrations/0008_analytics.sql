-- ---------------------------------------------------------------------------
-- Trafikkanalyse bygget på Caddy-loggen
--
-- Snoat eier proxy-laget for alle kundedomener. Hver eneste forespørsel til
-- hver eneste app passerer allerede Caddy, som vet hvilket vertsnavn den gjaldt,
-- hvilken IP den kom fra, hva statuskoden ble og hvor mange bytes som gikk ut.
-- Statistikken hentes derfor ut av den strømmen – ikke av et JavaScript vi
-- injiserer i kundens kildekode.
--
-- Det gir tre ting injisert sporing aldri kan gi:
--   * Null kode i kundens prosjekt, og null som kan brekke et bygg.
--   * Virker for alle rammeverk og språk, og for apper som allerede er deployet.
--   * IP-en kommer fra TCP-koblingen og kan ikke forfalskes med en header.
--
-- Datamodellen er ferdig aggregert med vilje. På en delt VPS er forskjellen
-- mellom «les 30 ferdige rader» og «count(*) over fire millioner» forskjellen
-- på om Postgres har headroom til resten av plattformen. Rå treff lagres ikke.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 0. Rydd bort Umami-forsøket
--
-- Den forrige runden på analytics kjørte Umami i egen container mot dette
-- skjemaet. Den ble aldri tatt i bruk i produksjon – CORS på `/api/send`
-- blokkerte hvert eneste treff – så det er ingen data å ta vare på her.
-- Guardet er `if exists`, slik at migrasjonen tåler å kjøres om igjen (og det
-- gjør den: db-migrate kjører alle filene ved hver oppstart).
-- ---------------------------------------------------------------------------
drop schema if exists umami cascade;

alter table public.projects
  drop column if exists umami_website_id;

-- ---------------------------------------------------------------------------
-- 1. Skjema
--
-- Ligger utenfor `public` med vilje: PostgREST eksponerer kun `public`, så
-- ingen av tabellene under er nåbare fra nettleseren uansett hvordan RLS
-- skulle bli konfigurert i framtiden. Dashboardet leser gjennom backend, som
-- går veien om `analytics_summary()` lenger ned.
-- ---------------------------------------------------------------------------
create schema if not exists analytics;

-- ---------------------------------------------------------------------------
-- 2. Timesrollup – hele grafen og alle nøkkeltallene
--
-- Én rad per prosjekt per time, uansett om timen hadde 3 eller 300 000 treff.
-- `bytes_out` og `requests` er også det faktureringen trenger for å måle
-- faktisk forbruk (services/plans.ts), og er derfor med selv om UI-et skulle
-- slutte å vise dem.
-- ---------------------------------------------------------------------------
create table if not exists analytics.rollup_hourly (
  project_id      uuid        not null references public.projects(id) on delete cascade,
  hour            timestamptz not null,

  -- Sidevisninger = svar med Content-Type text/html. Et bilde eller et
  -- API-kall er en forespørsel, men ikke en sidevisning.
  pageviews       bigint      not null default 0,
  -- Nye besøkende som startet et besøk i denne timen. Se ingest-funksjonen:
  -- «ny» avgjøres av om hashen allerede finnes i visitors_daily, ikke av en
  -- teller i minnet, slik at en omstart av backend ikke dobbelttelller.
  visits          bigint      not null default 0,
  requests        bigint      not null default 0,
  bytes_out       bigint      not null default 0,
  errors_4xx      bigint      not null default 0,
  errors_5xx      bigint      not null default 0,
  -- Sum, ikke snitt: snitt av snitt er feil når timene har ulikt antall treff.
  -- UI-et deler på `requests` selv.
  duration_sum_ms bigint      not null default 0,
  -- Boter holdes utenfor alle tallene over, men telles her så vi kan se hvor
  -- mye av trafikken de faktisk utgjør når filteret skal kalibreres.
  bot_requests    bigint      not null default 0,

  primary key (project_id, hour)
);

-- ---------------------------------------------------------------------------
-- 3. Unike besøkende
--
-- `visitor` er sha256(dagssalt ‖ prosjekt ‖ IP ‖ user-agent), 32 byte. Saltet
-- lever kun i minnet til backend og roterer ved døgnskiftet. Etter rotasjon
-- finnes det ingen nøkkel som kan koble gårsdagens hash til dagens, og heller
-- ingen som kan gå tilbake til IP-en. Det er dette som gjør IDen anonym og
-- ikke bare pseudonym.
--
-- Konsekvensen er at «unike besøkende» over flere dager er summen av daglige
-- unike, ikke ekte unike personer. Samme kompromiss som Plausible og Umami.
-- ---------------------------------------------------------------------------
create table if not exists analytics.visitors_daily (
  project_id uuid  not null references public.projects(id) on delete cascade,
  day        date  not null,
  visitor    bytea not null,

  primary key (project_id, day, visitor)
);

-- ---------------------------------------------------------------------------
-- 4. Dimensjoner – toppsider, henvisere, nettlesere, OS, enheter, land
--
-- Én rad per verdi per dag. Ingesten kutter halen selv, så en app under
-- portscanning ikke kan skrive hundretusen unike stier hit på et døgn.
-- ---------------------------------------------------------------------------
create table if not exists analytics.rollup_dim (
  project_id uuid   not null references public.projects(id) on delete cascade,
  day        date   not null,
  dim        text   not null check (dim in ('path', 'referrer', 'browser', 'os', 'device', 'country')),
  value      text   not null,
  hits       bigint not null default 0,

  primary key (project_id, day, dim, value)
);

-- Dashboardet spør alltid «topp N for denne dimensjonen i dette vinduet».
create index if not exists rollup_dim_lookup_idx
  on analytics.rollup_dim (project_id, dim, day desc, hits desc);

-- ---------------------------------------------------------------------------
-- 5. RLS
--
-- Tabellene ligger allerede utenfor det PostgREST eksponerer, så dette er
-- belte og bukseseler. RLS uten policy = ingen slipper til; `service_role` og
-- security definer-funksjonene under går utenom, og de er de eneste veiene inn.
-- ---------------------------------------------------------------------------
alter table analytics.rollup_hourly  enable row level security;
alter table analytics.visitors_daily enable row level security;
alter table analytics.rollup_dim     enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Ingest
--
-- Backend samler treff i minnet i fem sekunder, aggregerer dem der, og sender
-- resultatet hit som én jsonb. En travel app blir dermed noen få rader per
-- kall i stedet for tusenvis av INSERT-er.
--
-- Formen på `payload`:
--   {
--     "hourly":   [{project_id, hour, pageviews, requests, bytes_out,
--                   errors_4xx, errors_5xx, duration_sum_ms, bot_requests}],
--     "visitors": [{project_id, day, hour, visitor}],   -- visitor = hex
--     "dims":     [{project_id, day, dim, value, hits}]
--   }
--
-- Joinen mot public.projects er ikke pynt: et prosjekt kan slettes mellom
-- loggkallet og flushen, og uten den ville en fremmednøkkelfeil ha forkastet
-- hele batchen for alle de andre prosjektene.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_ingest_batch(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, analytics, pg_temp
as $$
begin
  -- Besøkende og timesrollup i én setning.
  --
  -- `on conflict do nothing ... returning` gir tilbake nøyaktig de radene som
  -- faktisk ble satt inn, altså de besøkende vi ikke hadde sett i dag. Det er
  -- selve definisjonen av «nytt besøk», og den er korrekt uansett hvor mange
  -- ganger backend startes på nytt i løpet av døgnet.
  with incoming_visitors as (
    select (e ->> 'project_id')::uuid        as project_id,
           (e ->> 'day')::date               as day,
           (e ->> 'hour')::timestamptz       as hour,
           decode(e ->> 'visitor', 'hex')    as visitor
    from jsonb_array_elements(coalesce(payload -> 'visitors', '[]'::jsonb)) as e
  ),
  inserted_visitors as (
    insert into analytics.visitors_daily (project_id, day, visitor)
    select v.project_id, v.day, v.visitor
    from incoming_visitors v
    join public.projects p on p.id = v.project_id
    on conflict do nothing
    returning project_id, day, visitor
  ),
  new_visits as (
    select v.project_id, v.hour, count(*)::bigint as visits
    from inserted_visitors i
    join incoming_visitors v using (project_id, day, visitor)
    group by v.project_id, v.hour
  ),
  incoming_hourly as (
    select (e ->> 'project_id')::uuid           as project_id,
           (e ->> 'hour')::timestamptz          as hour,
           (e ->> 'pageviews')::bigint          as pageviews,
           (e ->> 'requests')::bigint           as requests,
           (e ->> 'bytes_out')::bigint          as bytes_out,
           (e ->> 'errors_4xx')::bigint         as errors_4xx,
           (e ->> 'errors_5xx')::bigint         as errors_5xx,
           (e ->> 'duration_sum_ms')::bigint    as duration_sum_ms,
           (e ->> 'bot_requests')::bigint       as bot_requests
    from jsonb_array_elements(coalesce(payload -> 'hourly', '[]'::jsonb)) as e
  ),
  merged as (
    select coalesce(h.project_id, v.project_id)     as project_id,
           coalesce(h.hour, v.hour)                 as hour,
           coalesce(h.pageviews, 0)                 as pageviews,
           coalesce(v.visits, 0)                    as visits,
           coalesce(h.requests, 0)                  as requests,
           coalesce(h.bytes_out, 0)                 as bytes_out,
           coalesce(h.errors_4xx, 0)                as errors_4xx,
           coalesce(h.errors_5xx, 0)                as errors_5xx,
           coalesce(h.duration_sum_ms, 0)           as duration_sum_ms,
           coalesce(h.bot_requests, 0)              as bot_requests
    from incoming_hourly h
    full join new_visits v on v.project_id = h.project_id and v.hour = h.hour
  )
  insert into analytics.rollup_hourly as r (
    project_id, hour, pageviews, visits, requests, bytes_out,
    errors_4xx, errors_5xx, duration_sum_ms, bot_requests
  )
  select m.project_id, m.hour, m.pageviews, m.visits, m.requests, m.bytes_out,
         m.errors_4xx, m.errors_5xx, m.duration_sum_ms, m.bot_requests
  from merged m
  join public.projects p on p.id = m.project_id
  on conflict (project_id, hour) do update set
    pageviews       = r.pageviews       + excluded.pageviews,
    visits          = r.visits          + excluded.visits,
    requests        = r.requests        + excluded.requests,
    bytes_out       = r.bytes_out       + excluded.bytes_out,
    errors_4xx      = r.errors_4xx      + excluded.errors_4xx,
    errors_5xx      = r.errors_5xx      + excluded.errors_5xx,
    duration_sum_ms = r.duration_sum_ms + excluded.duration_sum_ms,
    bot_requests    = r.bot_requests    + excluded.bot_requests;

  -- Dimensjonene.
  insert into analytics.rollup_dim as d (project_id, day, dim, value, hits)
  select (e ->> 'project_id')::uuid,
         (e ->> 'day')::date,
         e ->> 'dim',
         e ->> 'value',
         (e ->> 'hits')::bigint
  from jsonb_array_elements(coalesce(payload -> 'dims', '[]'::jsonb)) as e
  join public.projects p on p.id = (e ->> 'project_id')::uuid
  on conflict (project_id, day, dim, value) do update set
    hits = d.hits + excluded.hits;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Uthenting – alt dashboardet trenger i ett kall
--
-- Eierskapssjekken ligger i backend (`loadOwnedProject`), som er den eneste
-- som kan kalle denne. Se GRANT-ene nederst: `anon` og `authenticated` har
-- ikke execute, så en innlogget bruker kan ikke kalle den med en fremmed
-- prosjekt-ID fra nettleseren.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_summary(
  p_project_id uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_unit       text default 'day',
  p_limit      integer default 10,
  -- Døgnskillet er norsk, ikke UTC. Uten dette ville «i dag» startet kl. 01:00
  -- eller 02:00 for kunden, og søylene i grafen ville ligget en time feil.
  p_tz         text default 'Europe/Oslo'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, analytics, pg_temp
as $$
declare
  v_unit   text;
  v_step   interval;
  v_totals jsonb;
  v_series jsonb;
  v_dims   jsonb;
  v_visitors bigint;
  v_from_day date := (p_from at time zone p_tz)::date;
  v_to_day   date := (p_to   at time zone p_tz)::date;
begin
  -- date_trunc tar imot vilkårlige strenger og feiler stygt på ukjente. Her er
  -- lista over det UI-et faktisk kan be om; alt annet blir 'day'.
  v_unit := case lower(coalesce(p_unit, 'day'))
              when 'hour'  then 'hour'
              when 'day'   then 'day'
              when 'month' then 'month'
              else 'day'
            end;
  v_step := ('1 ' || v_unit)::interval;

  select jsonb_build_object(
           'pageviews',       coalesce(sum(pageviews), 0),
           'visits',          coalesce(sum(visits), 0),
           'requests',        coalesce(sum(requests), 0),
           'bytes_out',       coalesce(sum(bytes_out), 0),
           'errors_4xx',      coalesce(sum(errors_4xx), 0),
           'errors_5xx',      coalesce(sum(errors_5xx), 0),
           'bot_requests',    coalesce(sum(bot_requests), 0),
           -- Snittet regnes her, av summene, ikke som et snitt av timesnitt.
           'avg_duration_ms', case when coalesce(sum(requests), 0) > 0
                                   then round(sum(duration_sum_ms)::numeric / sum(requests))
                                   else 0 end
         )
    into v_totals
    from analytics.rollup_hourly
   where project_id = p_project_id
     and hour >= p_from
     and hour <  p_to;

  -- Grafen skal ha en søyle per bøtte også der det ikke var trafikk, ellers
  -- ser en stille uke ut som en tettpakket uke med lave tall.
  -- Bøttene regnes i norsk tid og sendes tilbake som timestamptz, slik at
  -- nettleseren tegner dem på riktig dato uten å måtte kjenne tidssonen.
  select coalesce(jsonb_agg(row order by row ->> 't'), '[]'::jsonb)
    into v_series
    from (
      select jsonb_build_object(
               't',         b.t,
               'pageviews', coalesce(h.pageviews, 0),
               'visits',    coalesce(h.visits, 0),
               'requests',  coalesce(h.requests, 0),
               'errors',    coalesce(h.errors_5xx, 0)
             ) as row
        from generate_series(
               date_trunc(v_unit, p_from at time zone p_tz) at time zone p_tz,
               date_trunc(v_unit, p_to   at time zone p_tz) at time zone p_tz,
               v_step
             ) as b(t)
        left join (
          select date_trunc(v_unit, hour at time zone p_tz) at time zone p_tz as t,
                 sum(pageviews)  as pageviews,
                 sum(visits)     as visits,
                 sum(requests)   as requests,
                 sum(errors_5xx) as errors_5xx
            from analytics.rollup_hourly
           where project_id = p_project_id
             and hour >= p_from
             and hour <  p_to
           group by 1
        ) h on h.t = b.t
    ) s;

  -- Daglige unike summeres. Se kommentaren på visitors_daily: over flere dager
  -- er dette «summen av daglige unike», ikke ekte unike personer.
  select count(*)::bigint
    into v_visitors
    from analytics.visitors_daily
   where project_id = p_project_id
     and day >= v_from_day
     and day <= v_to_day;

  select coalesce(jsonb_object_agg(dim, values), '{}'::jsonb)
    into v_dims
    from (
      select dim,
             jsonb_agg(jsonb_build_object('value', value, 'hits', hits)
                       order by hits desc) as values
        from (
          select dim, value, sum(hits) as hits,
                 row_number() over (partition by dim order by sum(hits) desc) as rank
            from analytics.rollup_dim
           where project_id = p_project_id
             and day >= v_from_day
             and day <= v_to_day
           group by dim, value
        ) ranked
       where rank <= greatest(p_limit, 1)
       group by dim
    ) d;

  return jsonb_build_object(
    'totals',   v_totals,
    'visitors', coalesce(v_visitors, 0),
    'series',   v_series,
    'dims',     v_dims,
    'unit',     v_unit
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Sletting etter lagringsbegrensning (GDPR art. 5 nr. 1 bokstav e)
--
-- Besøkendehashene har kortest levetid: de er det eneste som er per-person,
-- selv om de er anonymisert. Aggregatene er ren statistikk og kan leve lenger.
-- Kalles nattlig fra backend (services/analytics-ingest.ts).
-- ---------------------------------------------------------------------------
create or replace function public.analytics_prune(
  p_visitor_days integer default 90,
  p_rollup_days  integer default 400,
  p_dim_keep     integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, analytics, pg_temp
as $$
declare
  v_visitors  bigint;
  v_dims      bigint;
  v_hourly    bigint;
  v_compacted bigint;
begin
  delete from analytics.visitors_daily
   where day < current_date - p_visitor_days;
  get diagnostics v_visitors = row_count;

  delete from analytics.rollup_dim
   where day < current_date - p_rollup_days;
  get diagnostics v_dims = row_count;

  delete from analytics.rollup_hourly
   where hour < now() - make_interval(days => p_rollup_days);
  get diagnostics v_hourly = row_count;

  -- Kutt halen på dimensjonene.
  --
  -- Ingesten har allerede et tak per flush, men det taket gjelder bare de
  -- sekundene bufferet lever. En app som blir portscannet gjennom natten kan
  -- likevel få titusenvis av unike stier inn i tabellen, én flush av gangen.
  -- Her folder vi alt utenfor topp N sammen til «(annet)», slik at én dag per
  -- prosjekt per dimensjon aldri koster mer enn N+1 rader.
  --
  -- Gårsdagen og bakover: dagen i dag er fortsatt i endring, og skal ikke
  -- komprimeres mens tallene fremdeles vokser.
  --
  -- To setninger, ikke én med data-modifiserende CTE. I én setning ville DELETE
  -- og INSERT sett samme snapshot, og oppdateringen av «(annet)»-raden kunne
  -- gått tapt mot slettingen av den samme raden. Her fullfører den første
  -- setningen før den andre begynner.
  --
  -- «(annet)» holdes utenfor rangeringen i begge, slik at raden aldri kan bli
  -- sin egen slettekandidat og rangeringen er identisk i de to setningene.
  with ranked as (
    select project_id, day, dim, value, hits,
           row_number() over (partition by project_id, day, dim order by hits desc) as rank
      from analytics.rollup_dim
     where day < current_date
       and value <> '(annet)'
  )
  insert into analytics.rollup_dim as d (project_id, day, dim, value, hits)
  select project_id, day, dim, '(annet)', sum(hits)
    from ranked
   where rank > p_dim_keep
   group by project_id, day, dim
  on conflict (project_id, day, dim, value) do update set
    hits = d.hits + excluded.hits;

  with ranked as (
    select project_id, day, dim, value,
           row_number() over (partition by project_id, day, dim order by hits desc) as rank
      from analytics.rollup_dim
     where day < current_date
       and value <> '(annet)'
  )
  delete from analytics.rollup_dim d
   using ranked r
   where d.project_id = r.project_id
     and d.day        = r.day
     and d.dim        = r.dim
     and d.value      = r.value
     and r.rank       > p_dim_keep;
  get diagnostics v_compacted = row_count;

  return jsonb_build_object(
    'visitors',  v_visitors,
    'dims',      v_dims,
    'hourly',    v_hourly,
    'compacted', v_compacted
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Rettigheter
--
-- Funksjonene er `security definer` og ligger i `public`, som PostgREST
-- eksponerer. Uten disse revoke-ene ville en hvilken som helst innlogget
-- bruker kunne kalt dem fra nettleseren – `analytics_ingest_batch` for å dikte
-- opp trafikk, og `analytics_summary` for å lese en fremmed kundes tall.
-- ---------------------------------------------------------------------------
revoke all on function public.analytics_ingest_batch(jsonb) from public, anon, authenticated;
revoke all on function public.analytics_summary(uuid, timestamptz, timestamptz, text, integer, text) from public, anon, authenticated;
revoke all on function public.analytics_prune(integer, integer, integer) from public, anon, authenticated;

grant execute on function public.analytics_ingest_batch(jsonb) to service_role;
grant execute on function public.analytics_summary(uuid, timestamptz, timestamptz, text, integer, text) to service_role;
grant execute on function public.analytics_prune(integer, integer, integer) to service_role;
