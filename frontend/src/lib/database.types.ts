/**
 * Håndskrevne typer for Snoat-skjemaet.
 * Speiler supabase/migrations/0001_snoat_schema.sql og CONTEXT_FOR_AI/04_database_schema.md.
 */

export type DeploymentStatus = "queued" | "building" | "success" | "failed";

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  /** URL-vennlig slug – blir subdomenet `<name>.<snoat-domenet>`. */
  name: string;
  repo_url: string;
  build_command: string | null;
  env_vars: Record<string, string>;
  /**
   * GitHub App-installasjonen repoet ble valgt gjennom, satt av repo-velgeren.
   * NULL for offentlige repoer limt inn som URL.
   */
  github_installation_id: number | null;
  /**
   * Katalogen i byggeresultatet som serveres statisk av Caddy, uten container
   * (f.eks. `dist`). NULL = prosjektet kjøres som container.
   */
  static_output_dir: string | null;
  /** Serverer `index.html` for URL-er uten treff. Kreves av SPA-er med klientruting. */
  static_spa_fallback: boolean;
  created_at: string;
}

export interface Deployment {
  id: string;
  project_id: string;
  status: DeploymentStatus;
  commit_hash: string | null;
  logs: string;
  url: string | null;
  created_at: string;
}

/** Et prosjekt slik dashboardet henter det: med sin nyeste deployment. */
export interface ProjectWithLatestDeployment extends Project {
  latestDeployment: Deployment | null;
}
