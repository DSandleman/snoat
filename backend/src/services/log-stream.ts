import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

/**
 * Samler byggelogger og skriver dem til `deployments.logs`.
 *
 * Nixpacks produserer hundrevis av linjer i løpet av sekunder. Ett UPDATE per
 * linje ville både overbelaste Postgres og gi dashboardet en strøm av
 * Realtime-events det ikke klarer å tegne. Vi buffrer derfor og skyller med et
 * fast intervall – logg som er et halvsekund gammel er fortsatt «live» for en
 * bruker som ser på en progressbar.
 */
export class LogStream {
  private buffer = "";
  private flushing: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private accumulated = "";

  constructor(
    private readonly deploymentId: string,
    private readonly flushIntervalMs = 500,
  ) {}

  /** Legger til en linje. `\n` settes på hvis den mangler. */
  write(chunk: string): void {
    if (!chunk) return;
    this.buffer += chunk.endsWith("\n") ? chunk : `${chunk}\n`;
    this.scheduleFlush();
  }

  /** Skriver en overskrift som skiller stegene i pipelinen fra hverandre. */
  step(title: string): void {
    this.write(`\n── ${title} ──`);
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Skriver bufferet til databasen.
   *
   * Vi holder hele loggen i minnet og skriver den komplette teksten hver gang,
   * i stedet for å lese-modifisere-skrive mot databasen. Det gjør skrivingen
   * idempotent og unngår at to samtidige flush-er mister linjer.
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buffer) return await this.flushing;

    this.accumulated += this.buffer;
    this.buffer = "";
    const snapshot = this.accumulated;

    this.flushing = this.flushing.then(async () => {
      const { error } = await supabase
        .from("deployments")
        .update({ logs: snapshot })
        .eq("id", this.deploymentId);

      if (error) {
        // Logging som feiler skal aldri velte selve deploymenten.
        logger.warn({ deploymentId: this.deploymentId, err: error }, "Kunne ikke skrive byggelogg");
      }
    });

    return await this.flushing;
  }

  /** Hele loggen slik den er skrevet så langt. */
  get text(): string {
    return this.accumulated + this.buffer;
  }
}
