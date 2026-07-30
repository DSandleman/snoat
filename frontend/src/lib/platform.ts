/**
 * Plattformkonstantene frontend trenger for å vise hvor apper havner, og hvor
 * kundene skal peke sine egne domener.
 *
 * Vite baker `VITE_`-variabler inn i bundlen ved build, ikke ved oppstart – se
 * 09_production_deployment.md. Verdiene her følger derfor `.env` på maskinen
 * som bygde frontend, og fallbackene er produksjonsverdiene for snoat.com.
 */

/** Domenet deployede apper havner under. Følger `SNOAT_APP_DOMAIN_SUFFIX`. */
export const appDomainSuffix =
  (import.meta.env.VITE_SNOAT_APP_DOMAIN_SUFFIX as string | undefined) ?? ".snoat.com";

/**
 * IP-en kundene peker sitt eget domene mot med en A-record. Følger
 * `SNOAT_SERVER_IP` – VPS-en Caddy står på (09_production_deployment.md).
 */
export const snoatServerIp =
  (import.meta.env.VITE_SNOAT_SERVER_IP as string | undefined) ?? "38.87.117.167";

/** `<slug>.snoat.com` – verten Caddy ruter til prosjektets container. */
export const projectHostname = (slug: string) => `${slug}${appDomainSuffix}`;

/** Full URL til prosjektet. `http` lokalt, `https` i produksjon – slik Caddy kjører. */
export function projectUrl(slug: string): string {
  const hostname = projectHostname(slug);
  const isLocal = hostname === "localhost" || hostname.endsWith(".localhost");
  return `${isLocal ? "http" : "https"}://${hostname}`;
}
