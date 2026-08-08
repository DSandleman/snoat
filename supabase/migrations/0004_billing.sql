-- ---------------------------------------------------------------------------
-- Abonnement, planer og bruksmåling – implementerer
-- CONTEXT_FOR_AI/12_billing_and_plans.md.
--
-- Må være idempotent: db-migrate kjører alle migrasjoner på nytt ved oppstart.
-- ---------------------------------------------------------------------------

-- --- Enums ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_tier') then
    create type public.subscription_tier as enum ('free', 'pro', 'business');
  end if;
end
$$;

-- Speiler Stripe sine subscription-statuser, minus de vi ikke bruker
-- (`incomplete_expired`, `paused`). `unpaid` er endestasjonen når dunning gir
-- opp; `canceled` er et aktivt valg fra kunden eller oss.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type public.subscription_status as enum (
      'active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete'
    );
  end if;
end
$$;

-- --- subscriptions ----------------------------------------------------------
--
-- ⚠️ Egen tabell, IKKE kolonner på `profiles`. Dette er ikke en smakssak.
--
-- `profiles` har policyen `profiles_update_own`, og RLS i Postgres er *rad*-nivå,
-- ikke kolonne-nivå. Lå `plan` der, kunne enhver innlogget bruker kjørt
--
--   supabase.from('profiles').update({ plan: 'business' }).eq('id', user.id)
--
-- rett fra nettleserkonsollen og gitt seg selv Business gratis – raden er jo
-- deres egen. Her finnes det ingen update-policy i det hele tatt, så
-- `authenticated` kan lese sin egen rad og ingenting mer. All skriving går
-- gjennom backend med service-role-nøkkelen, etter en verifisert Stripe-signatur.
-- Samme resonnement som `github_installations` i 0002.
create table if not exists public.subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan public.subscription_tier not null default 'free',
  status public.subscription_status not null default 'active',

  -- Hvor abonnementet styres fra. 'stripe' er kort og webhooks; 'invoice' er
  -- norske bedrifter og offentlig sektor som betaler mot EHF-faktura utenom
  -- Stripe. Uten dette skillet ville en manuelt satt bedriftsplan sett ut som
  -- en Stripe-rad med manglende data, og neste webhook kunne nullstilt den.
  source text not null default 'stripe',

  stripe_customer_id text unique,
  stripe_subscription_id text unique,

  -- Slutten på perioden det er betalt for. Brukes som nådefrist når kortet
  -- feiler: tilgangen følger perioden, ikke øyeblikket trekket feilet.
  current_period_end timestamptz,

  -- Satt første gang status ble past_due/unpaid, nullet når betalingen går
  -- gjennom igjen. Det er denne – ikke `updated_at` – som avgjør når
  -- nådeperioden er ute, siden `updated_at` flyttes av enhver webhook.
  delinquent_since timestamptz,

  -- Kunden har sagt opp, men perioden løper ut. Dashboardet skal si «aktiv til
  -- <dato>», ikke «kansellert», så lenge dette er sant og status er active.
  cancel_at_period_end boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint subscriptions_source_check check (source in ('stripe', 'invoice'))
);

create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);

comment on table public.subscriptions is
  'Abonnement per bruker. Kun lesbar for eieren – all skriving skjer fra backend med service-role etter verifisert Stripe-signatur.';

-- --- Alle brukere har en rad --------------------------------------------------
--
-- Backend slår opp planen ved hver deployment. Uten en garantert rad måtte hvert
-- oppslag håndtert «finnes ikke» som et eget tilfelle, og det tilfellet ville
-- fort blitt tolket som «ingen grenser» av en fremtidig endring. En rad med
-- plan='free' er en sikrere standardtilstand enn ingen rad.
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- Brukere som fantes før denne migrasjonen.
insert into public.subscriptions (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

-- --- Row Level Security -------------------------------------------------------
alter table public.subscriptions enable row level security;

-- Bare lesing. Det finnes bevisst ingen insert/update/delete-policy: se
-- kommentaren over tabellen.
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

-- --- stripe_events ------------------------------------------------------------
--
-- Stripe garanterer «at least once», ikke «exactly once»: samme event kommer
-- igjen ved timeout, ved retry og fra «Resend» i dashboardet deres. Uten denne
-- tabellen ville en gjentatt `customer.subscription.deleted` kunnet nedgradere
-- en kunde som allerede har abonnert på nytt.
--
-- Primærnøkkelen er Stripe sin event-id. Innsettingen er selve låsen: går den
-- gjennom, er eventet vårt å behandle. Feiler den på konflikt, er det behandlet.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- RLS på uten en eneste policy: `authenticated` og `anon` kommer ikke til,
-- service_role omgår RLS. Dette er backend-intern tilstand og angår ingen bruker.
alter table public.stripe_events enable row level security;

comment on table public.stripe_events is
  'Idempotensnøkler for Stripe-webhooks. Kun service_role har tilgang.';

-- --- Byggeminutter -------------------------------------------------------------
--
-- Uten hvor lenge et bygg tok, finnes det ingen måte å håndheve en kvote på
-- byggeminutter. Pipelinen regner allerede ut varigheten for loggmeldingen
-- «Ferdig på 12.3s» – nå lagres den også.
--
-- Settes på både vellykkede og feilede bygg: et bygg som feiler etter ti minutter
-- har brukt ti minutter av verten. Er den NULL, er deploymenten fra før denne
-- migrasjonen, eller den pågår fortsatt.
alter table public.deployments
  add column if not exists duration_ms bigint;

comment on column public.deployments.duration_ms is
  'Hvor lenge bygget kjørte, i millisekunder. Grunnlaget for kvoten på byggeminutter. NULL = pågår, eller fra før 0004.';

-- Kvoten summerer varighet per bruker for inneværende kalendermåned, via
-- projects. Indeksen dekker oppslaget «alle deployments for dette prosjektet
-- etter dato» som allerede finnes fra 0001 – vi trenger bare varigheten med.
create index if not exists deployments_created_at_idx
  on public.deployments (created_at desc);
