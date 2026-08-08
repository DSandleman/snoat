-- Legger til custom_domain på projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS custom_domain text UNIQUE;

-- Siden prosjekter allerede har RLS som gir eier full tilgang, 
-- og policy for update ('users can update own projects') dekker hele raden,
-- trenger vi ingen nye policies for custom_domain.
