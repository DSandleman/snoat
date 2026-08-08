-- ---------------------------------------------------------------------------
-- Per-prosjekt planer (Free, Pro, Business).
--
-- Legger til `plan` på `public.projects`, slik at hvert prosjekt har sin egen
-- plan uavhengig av brukerkontoen.
-- ---------------------------------------------------------------------------

-- 1. Legg til plan-kolonne på projects-tabellen
alter table public.projects
  add column if not exists plan public.subscription_tier not null default 'free';

comment on column public.projects.plan is
  'Planen prosjektet kjører på (free, pro, business). Kan kun oppdateres av backend via Stripe-webhooks.';

-- 2. Trigger for å forhindre direkte manipulering av `plan` via Supabase JS RLS
create or replace function public.prevent_project_plan_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Dersom forespørselen kommer fra en vanlig autentisert bruker (`authenticated`)
  -- og prøver å endre plan-feltet direkte, avvis endringen.
  if (current_user = 'authenticated' or auth.role() = 'authenticated') then
    if (new.plan is distinct from old.plan) then
      raise exception 'Plan kan ikke endres direkte fra klienten. Bruk Stripe checkout.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_project_plan_protection on public.projects;
create trigger enforce_project_plan_protection
  before update on public.projects
  for each row execute function public.prevent_project_plan_update();
