/**
 * Typer for Snoat-skjemaet i Supabase.
 * Speiler supabase/migrations/0001_snoat_schema.sql.
 */

export type DeploymentStatus = "queued" | "building" | "success" | "failed";

export interface Project {
  id: string;
  user_id: string;
  /** URL-vennlig slug – blir subdomenet `<name>.snoat.localhost`. */
  name: string;
  repo_url: string;
  build_command: string | null;
  env_vars: Record<string, string> | null;
  /**
   * Katalogen i byggeresultatet som serveres statisk (relativt til `/app`).
   * NULL = prosjektet kjøres som container. Se `services/static-site.ts`.
   */
  static_output_dir: string | null;
  /** Serverer `index.html` for URL-er uten treff. Kreves av SPA-er med klientruting. */
  static_spa_fallback: boolean;
  /**
   * Installasjonen repoet ble valgt gjennom. NULL for offentlige repoer limt
   * inn som URL – de klones uten autentisering.
   */
  github_installation_id: number | null;
  created_at: string;
}

/** Kobling mellom en Snoat-bruker og en GitHub App-installasjon. */
export interface GithubInstallation {
  id: string;
  user_id: string;
  installation_id: number;
  account_login: string;
  account_type: string;
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

/** Feil vi selv kaster i pipelinen, med et menneskelig lesbart steg. */
export class DeployError extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = "DeployError";
  }
}
