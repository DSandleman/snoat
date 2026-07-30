-- ---------------------------------------------------------------------------
-- Snoat MVP-skjema – implementerer CONTEXT_FOR_AI/04_database_schema.md.
--
-- Kjøres av `db-migrate`-tjenesten ETTER at GoTrue har opprettet auth.users.
-- Må være idempotent: tjenesten kjører alle migrasjoner på nytt ved oppstart.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- --- profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- --- projects ---------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  repo_url text not null,
  build_command text,
  env_vars jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint projects_name_slug_check check (name ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  constraint projects_user_name_unique unique (user_id, name)
);

create index if not exists projects_user_id_idx on public.projects (user_id);

-- --- deployments ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'deployment_status') then
    create type public.deployment_status as enum ('queued', 'building', 'success', 'failed');
  end if;
end
$$;

create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  status public.deployment_status not null default 'queued',
  commit_hash text,
  logs text not null default '',
  url text,
  created_at timestamptz not null default now()
);

create index if not exists deployments_project_id_created_at_idx
  on public.deployments (project_id, created_at desc);

-- --- Auto-opprett profil ved registrering -----------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- Row Level Security -----------------------------------------------------
-- Alle tabeller er eier-scopet. service_role (backend) omgår RLS og trenger
-- derfor ingen policies.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.deployments enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "projects_all_own" on public.projects;
create policy "projects_all_own" on public.projects
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Deployments opprettes kun av backend (service_role); brukeren kan lese sine egne.
drop policy if exists "deployments_select_own" on public.deployments;
create policy "deployments_select_own" on public.deployments
  for select to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = deployments.project_id and p.user_id = auth.uid()
    )
  );

-- --- Realtime ---------------------------------------------------------------
-- Dashboardet abonnerer på deployments for å vise byggestatus og logger live.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deployments'
  ) then
    alter publication supabase_realtime add table public.deployments;
  end if;
end
$$;

-- Realtime trenger hele raden for å kunne filtrere på project_id ved UPDATE.
alter table public.deployments replica identity full;
