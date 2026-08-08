-- Synlig tilstand for et stoppet prosjekt.
--
-- `POST /api/projects/:id/stop` fjernet Caddy-ruten og containerne, men skrev
-- ingenting til databasen. Alt dashboardet tegner – statusprikken, live-URL-en og
-- om stopp-knappen i det hele tatt vises – utledes av `deployments.status`, og
-- den er fortsatt `success` etter en stopp. Resultatet var at et vellykket stopp
-- så nøyaktig ut som ingenting: appen var borte, men siden sa fortsatt «Live»
-- med en lenke som ikke svarte.
--
-- Containeren kan ikke være kilden til den tilstanden. Frontend snakker med
-- Supabase, ikke med Docker, og «stoppet av brukeren» er dessuten noe annet enn
-- «ingen container kjører akkurat nå» – det siste er også sant midt i en
-- deployment og etter en serveromstart.
--
-- NULL = prosjektet er ikke stoppet. Tidspunktet framfor en boolean fordi «når
-- ble den slått av» er verdt å vite når noen spør hvorfor siden er nede.
alter table public.projects
  add column if not exists stopped_at timestamptz;

comment on column public.projects.stopped_at is
  'Når brukeren stoppet prosjektet. NULL = kjører (eller skal kjøre). Nullstilles når en ny deployment starter.';
