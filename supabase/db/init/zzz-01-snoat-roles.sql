-- ---------------------------------------------------------------------------
-- Kjøres én gang av postgres-entrypointet når datakatalogen initialiseres.
-- Setter passord på de rollene Supabase-tjenestene logger inn med, og oppretter
-- schemaene de forventer å finne. Alt er idempotent.
--
-- Applikasjonsskjemaet vårt ligger IKKE her – det ligger i supabase/migrations/
-- og kjøres av `db-migrate`-tjenesten, fordi det refererer auth.users, som
-- GoTrue først oppretter når den kjører sine egne migrasjoner.
-- ---------------------------------------------------------------------------

\set pgpass `echo "$POSTGRES_PASSWORD"`

do $$
declare
  r text;
begin
  foreach r in array array[
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'supabase_admin',
    'supabase_auth_admin',
    'supabase_storage_admin',
    'dashboard_user'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I noinherit', r);
    end if;
  end loop;
end
$$;

alter role authenticator with login password :'pgpass' noinherit;
alter role supabase_admin with login password :'pgpass' superuser createdb createrole replication bypassrls;
alter role supabase_auth_admin with login password :'pgpass' noinherit createrole;
alter role supabase_storage_admin with login password :'pgpass' noinherit createrole;
alter role dashboard_user with createdb createrole replication;

grant anon, authenticated, service_role to authenticator;

-- Realtime holder sin egen tilstand (tenants, extensions) i `_realtime`.
create schema if not exists _realtime;
alter schema _realtime owner to supabase_admin;

-- GoTrue oppretter `auth` selv, men trenger eierskap hvis schemaet finnes fra før.
create schema if not exists auth authorization supabase_auth_admin;

grant usage on schema public to anon, authenticated, service_role;
-- GoTrue needs to create schema_migrations in public if it's the first migration
grant create on schema public to supabase_auth_admin;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
