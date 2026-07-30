-- Statiske sider serveres av Caddy direkte fra disk, uten container.
--
-- Et prosjekt som bare produserer HTML, CSS og JS trenger ingen kjørende
-- prosess. Å holde en container i live 24/7 for det er den største unødvendige
-- kostnaden i plattformen: hundrevis av statiske sider koster titalls GB RAM som
-- containere, og tilnærmet ingenting som filer.
--
-- `static_output_dir` er katalogen i byggeresultatet som skal serveres, relativt
-- til `/app` i image-et (f.eks. `dist` for Vite, `out` for Next.js `export`).
-- NULL betyr «kjør som container», som er og blir standarden – vi gjetter ikke
-- på kundens vegne, fordi en feilgjetting gir en side som ser levende ut helt
-- til noe server-side kalles.

alter table public.projects
  add column if not exists static_output_dir text;

comment on column public.projects.static_output_dir is
  'Katalog i byggeresultatet som serveres statisk av Caddy (relativt til /app). NULL = kjør som container.';

-- Hva som skjer med en URL som ikke finnes som fil.
--
-- Av: 404, som er riktig for Astro, Hugo og Eleventy – der er `404.html` en ekte
-- side. På: `index.html` serveres i stedet, som er det en SPA med klientruting
-- (React Router, TanStack Router) trenger for at dype lenker skal virke ved
-- direkte innlasting. Standard er av, fordi den varianten aldri gjør en 404 om
-- til en 200 – feilen den kan gi er synlig, ikke stille.
alter table public.projects
  add column if not exists static_spa_fallback boolean not null default false;

comment on column public.projects.static_spa_fallback is
  'Serverer index.html for URL-er som ikke finnes som fil. Kreves av SPA-er med klientruting.';

-- Verdien havner i et `docker cp`-argument og i en filsti på verten. Den skal
-- derfor være en enkel relativ katalogsti: ingen absolutt sti, ingen `..`, og
-- ingen tegn som betyr noe spesielt for et skall. Backend validerer det samme på
-- nytt (`static-site.ts`) – service-role-nøkkelen omgår ikke bare RLS, den
-- omgår også denne constrainten hvis noen skriver direkte.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_static_output_dir_check'
  ) then
    alter table public.projects
      add constraint projects_static_output_dir_check check (
        static_output_dir is null
        or (
          static_output_dir ~ '^[A-Za-z0-9._][A-Za-z0-9._/-]{0,127}$'
          and static_output_dir !~ '\.\.'
          and static_output_dir !~ '//'
        )
      );
  end if;
end
$$;
