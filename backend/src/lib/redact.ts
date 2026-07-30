/**
 * Fjerner brukernavn og passord fra URL-er i en tekst.
 *
 * Byggeloggen lagres i `deployments.logs` og leses av frontend med anon-nøkkelen.
 * Et GitHub-installasjonstoken i klone-URL-en ville dermed vært synlig for alle
 * som kan se loggen. Både det vi selv logger og alt git skriver til stderr må
 * gjennom denne – git gjentar URL-en ordrett i sine egne feilmeldinger, og
 * execa gjentar hele kommandolinjen i sine.
 */
export function redactCredentials(text: string): string {
  return text.replace(/(\bhttps?:\/\/)[^/@\s]+@/gi, "$1***@");
}
