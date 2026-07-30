-- ---------------------------------------------------------------------------
-- GitHub App-integrasjon.
--
-- Lar brukeren velge repository fra en liste i stedet for å lime inn en URL,
-- og gjør det mulig å deploye private repoer.
--
-- Vi lagrer aldri et GitHub-token. Installasjons-ID-en er nok: backend bytter
-- den inn i et kortlevd token (én time) via App-ens private nøkkel når det
-- trengs. Blir databasen lekket, følger det ingen tilgang til brukerens kode
-- med den – i motsetning til et lagret OAuth-token.
--
-- Må være idempotent: db-migrate kjører alle migrasjoner på nytt ved oppstart.
-- ---------------------------------------------------------------------------

-- --- github_installations ---------------------------------------------------
create table if not exists public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- GitHub sine installasjons-ID-er er tall utenfor int4-området.
  installation_id bigint not null,
  account_login text not null,
  account_type text not null default 'User',
  created_at timestamptz not null default now(),
  -- Én installasjon kan kobles til flere Snoat-kontoer (f.eks. en org der to
  -- kolleger begge bruker Snoat), men aldri to ganger til samme konto.
  constraint github_installations_user_installation_unique unique (user_id, installation_id)
);

create index if not exists github_installations_user_id_idx
  on public.github_installations (user_id);

-- --- projects.github_installation_id ----------------------------------------
-- Hvilken installasjon repoet ble valgt gjennom. NULL = offentlig repo limt inn
-- som URL, som klones uten autentisering slik det alltid har blitt gjort.
alter table public.projects
  add column if not exists github_installation_id bigint;

-- --- Row Level Security -----------------------------------------------------
-- Kun lesetilgang for brukeren. Koblingen opprettes utelukkende av backend
-- (service_role) etter at GitHub har bekreftet installasjonen – en klient som
-- kunne skrive her, kunne knyttet seg til en annens repoer.
alter table public.github_installations enable row level security;

drop policy if exists "github_installations_select_own" on public.github_installations;
create policy "github_installations_select_own" on public.github_installations
  for select to authenticated using (user_id = auth.uid());
