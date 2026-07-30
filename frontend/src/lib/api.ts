import type { Deployment } from "./database.types";
import { getSupabase } from "./supabase";

const baseUrl = (import.meta.env.VITE_SNOAT_API_URL as string | undefined) ?? "";

/**
 * Kall mot Snoat-backend (bygge-motoren).
 *
 * Vi sender brukerens Supabase access-token videre. Backend bruker
 * service-role-nøkkelen og omgår RLS, så den må verifisere tokenet og
 * eierskapet selv – derfor er dette den eneste måten å nå API-et på.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;

  if (!token) throw new Error("Du er ikke logget inn.");

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const body = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Forespørselen feilet (${response.status})`);
  }

  return body as T;
}

/** Starter en deployment. Svarer så snart raden finnes – bygget kjører videre. */
export function deployProject(projectId: string): Promise<{ deployment: Deployment }> {
  return request(`/api/projects/${projectId}/deploy`, { method: "POST" });
}

/** Stopper containeren og fjerner ruten, uten å slette prosjektet. */
export function stopProject(projectId: string): Promise<{ stopped: boolean }> {
  return request(`/api/projects/${projectId}/stop`, { method: "POST" });
}

/** Et repository brukeren har gitt Snoat tilgang til via GitHub App-en. */
export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  cloneUrl: string;
  defaultBranch: string;
  updatedAt: string | null;
  installationId: number;
}

export interface GithubStatus {
  /** Er GitHub App-en satt opp på denne Snoat-installasjonen i det hele tatt? */
  configured: boolean;
  /** Har brukeren installert den på minst én konto? */
  connected: boolean;
  installations: Array<{ installationId: number; accountLogin: string; accountType: string }>;
  installUrl: string | null;
}

export function getGithubStatus(): Promise<GithubStatus> {
  return request("/api/github/status");
}

export function listGithubRepos(): Promise<{ repos: GithubRepo[] }> {
  return request("/api/github/repos");
}
