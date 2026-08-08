import { isbot } from "isbot";

/**
 * Tolkning av User-Agent-strengen til nettleser, OS og enhetstype.
 *
 * Skrevet for hånd i stedet for å hente inn `ua-parser-js`, av to grunner:
 * biblioteket la om til AGPL/PolyForm i v2, og granulariteten vi trenger
 * («Chrome», «Windows», «Mobil») er en brøkdel av det det kan. Skulle vi en dag
 * trenge versjonsnumre eller eksotiske klienter, er dette filen som byttes ut.
 *
 * Rekkefølgen på sjekkene er ikke tilfeldig, og er den vanligste kilden til feil
 * i UA-sniffing: Edge oppgir «Chrome», Chrome oppgir «Safari», og Opera oppgir
 * begge. Den mest spesifikke må derfor testes først.
 */

export interface UserAgentInfo {
  browser: string;
  os: string;
  device: string;
  isBot: boolean;
}

const UNKNOWN = "Ukjent";

function detectBrowser(ua: string): string {
  if (ua.includes("Edg/") || ua.includes("Edge/") || ua.includes("EdgiOS/")) return "Edge";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
  if (ua.includes("SamsungBrowser")) return "Samsung Internet";
  if (ua.includes("Vivaldi")) return "Vivaldi";
  if (ua.includes("Brave")) return "Brave";
  // CriOS/FxiOS er Chrome og Firefox på iOS. De kjører WebKit under panseret,
  // men brukeren har valgt nettleseren, og det er valget statistikken gjelder.
  if (ua.includes("Chrome/") || ua.includes("CriOS/")) return "Chrome";
  if (ua.includes("Firefox/") || ua.includes("FxiOS/")) return "Firefox";
  // Safari uten «Version/» er som regel en innebygd WebView, ikke nettleseren.
  if (ua.includes("Safari/") && ua.includes("Version/")) return "Safari";
  return UNKNOWN;
}

function detectOs(ua: string): string {
  if (ua.includes("Windows NT")) return "Windows";
  // Må stå før Linux: Android-strenger inneholder begge.
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad") || ua.includes("iPod")) return "iOS";
  if (ua.includes("CrOS")) return "ChromeOS";
  if (ua.includes("Mac OS X") || ua.includes("Macintosh")) return "macOS";
  if (ua.includes("Linux") || ua.includes("X11")) return "Linux";
  return UNKNOWN;
}

function detectDevice(ua: string): string {
  if (ua.includes("iPad") || ua.includes("Tablet")) return "Nettbrett";
  // Android uten «Mobile» er konvensjonen for nettbrett.
  if (ua.includes("Android") && !ua.includes("Mobile")) return "Nettbrett";
  if (ua.includes("Mobile") || ua.includes("iPhone") || ua.includes("iPod")) return "Mobil";
  if (ua === "") return UNKNOWN;
  return "Datamaskin";
}

/**
 * Cache over tolkede UA-strenger.
 *
 * De samme håndfull strengene gjentar seg i praktisk talt hver eneste
 * forespørsel, og regexfri strengsøking er billig, men ikke gratis når den
 * kjøres titusener av ganger i minuttet. Taket hindrer at en angriper som
 * roterer UA per forespørsel kan spise minnet.
 */
const cache = new Map<string, UserAgentInfo>();
const CACHE_LIMIT = 5_000;

export function parseUserAgent(raw: string | undefined): UserAgentInfo {
  const ua = (raw ?? "").slice(0, 512);

  const cached = cache.get(ua);
  if (cached) return cached;

  const info: UserAgentInfo = {
    browser: detectBrowser(ua),
    os: detectOs(ua),
    device: detectDevice(ua),
    // isbot vedlikeholder lista over crawlere, uptime-roboter og scrapere.
    // Tom UA er nesten alltid et script, ikke et menneske.
    isBot: ua === "" || isbot(ua),
  };

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(ua, info);

  return info;
}
