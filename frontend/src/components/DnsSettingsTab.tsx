import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@/lib/database.types";
import { projectHostname, projectUrl, snoatServerIp } from "@/lib/platform";

/** Hvor lenge «Kopiert!» vises på knappen. */
const COPY_RESET_MS = 2000;

type DomainMode = "root" | "subdomain";

interface DnsRecord {
  id: string;
  type: "A" | "CNAME";
  host: string;
  value: string;
  ttl: string;
  description: string;
}

export function DnsSettingsTab({ project, isLive }: { project: Project; isLive: boolean }) {
  const { t } = useTranslation();
  const [domain, setDomain] = useState("");
  const [mode, setMode] = useState<DomainMode>("root");
  const [subdomain, setSubdomain] = useState("app");

  const snoatHostname = projectHostname(project.name);
  const cleanDomain = normalizeDomain(domain);
  const displayDomain = cleanDomain || "dittdomene.no";
  const sub = normalizeHost(subdomain) || "app";

  const hasDomain = Boolean(cleanDomain);

  const records: DnsRecord[] =
    mode === "root"
      ? [
          {
            id: "root-a",
            type: "A",
            host: "@",
            value: snoatServerIp,
            ttl: "3600",
            description: t("dns.root_a_desc", { domain: displayDomain }),
          },
          {
            id: "www-cname",
            type: "CNAME",
            host: "www",
            value: snoatHostname,
            ttl: "3600",
            description: t("dns.www_cname_desc", { domain: displayDomain }),
          },
        ]
      : [
          {
            id: "sub-cname",
            type: "CNAME",
            host: sub,
            value: snoatHostname,
            ttl: "3600",
            description: t("dns.sub_cname_desc", { sub, domain: displayDomain }),
          },
        ];

  return (
    <div className="flex flex-col gap-6">
      {/* Prosjektets nåværende status og Snoat-adresse */}
      <div className="floating-card p-6 md:p-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-label text-label-md text-on-surface-variant">{t("dns.default_address")}</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-label text-xs ${
                isLive ? "bg-secondary/15 text-secondary" : "bg-surface-variant/40 text-on-surface-variant"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "animate-pulse bg-secondary" : "bg-on-surface-variant/60"}`} />
              {isLive ? t("dns.status_live") : t("dns.status_not_deployed")}
            </span>
          </div>

          <a
            href={projectUrl(project.name)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-sm text-primary hover:underline"
          >
            {snoatHostname}
          </a>
        </div>

        <p className="font-body text-xs text-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined icon-sm text-primary">lock</span>
          {t("dns.ssl_note")}
        </p>
      </div>

      {/* Domenekonfigurasjon */}
      <div className="floating-card p-6 md:p-8 flex flex-col gap-6">
        <div>
          <h2 className="font-headline text-headline-md text-on-surface">{t("dns.connect_title")}</h2>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            {t("dns.connect_desc")}
          </p>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center justify-between">
          <div className="flex flex-1 flex-col gap-2 max-w-md">
            <label className="font-label text-label-md text-on-surface-variant">{t("dns.domain_label")}</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="dittdomene.no"
              className="rounded-xl bg-surface-container px-4 py-3 font-mono text-sm text-on-surface outline-none ring-primary/60 placeholder:text-on-surface-variant/40 focus:ring-2"
            />
          </div>

          {mode === "subdomain" && (
            <div className="flex flex-col gap-2 md:w-48">
              <label className="font-label text-label-md text-on-surface-variant">{t("dns.subdomain_label")}</label>
              <input
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                placeholder="app"
                className="rounded-xl bg-surface-container px-4 py-3 font-mono text-sm text-on-surface outline-none ring-primary/60 placeholder:text-on-surface-variant/40 focus:ring-2"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="font-label text-label-md text-on-surface-variant">{t("dns.domain_type")}</span>
            <div className="inline-flex rounded-xl bg-surface-container p-1 shadow-[inset_0_1px_0_0_oklch(1_0_0/5%)]">
              <button
                type="button"
                onClick={() => setMode("root")}
                className={`rounded-lg px-4 py-2 font-label text-label-md transition-all ${
                  mode === "root" ? "bg-surface text-primary font-semibold shadow-sm" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {t("dns.mode_root", { domain: displayDomain })}
              </button>
              <button
                type="button"
                onClick={() => setMode("subdomain")}
                className={`rounded-lg px-4 py-2 font-label text-label-md transition-all ${
                  mode === "subdomain" ? "bg-surface text-primary font-semibold shadow-sm" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {t("dns.mode_subdomain", { sub, domain: displayDomain })}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* DNS Oppføringer (Vises KUN når bruker har fylt inn et domene) */}
      {hasDomain && (
        <div className="floating-card p-6 md:p-8 flex flex-col gap-6 animate-in fade-in-50 slide-in-from-top-2 duration-300">
          <div>
            <h2 className="font-headline text-headline-md text-on-surface">{t("dns.records_title")}</h2>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">
              {t("dns.records_desc")}
            </p>
          </div>

          {/* Vertikal liste over oppføringene */}
          <div className="flex flex-col gap-4">
            {records.map((record) => (
              <RecordRow key={record.id} record={record} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Komponent: Enkel, ren oppføringslinje i listen
// -----------------------------------------------------------------------------
function RecordRow({ record }: { record: DnsRecord }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-container p-5 shadow-[inset_0_1px_0_0_oklch(1_0_0/5%)] border border-surface-variant/20 hover:border-primary/40 transition-colors">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-primary/15 px-3 py-1 font-mono text-xs font-bold text-primary">
            {record.type}
          </span>
          <span className="font-body text-xs text-on-surface-variant">{record.description}</span>
        </div>

        <span className="font-mono text-xs text-on-surface-variant/60">TTL: {record.ttl}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        {/* Host / Navn */}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 shadow-[inset_0_1px_0_0_oklch(1_0_0/6%)]">
          <div className="flex flex-col min-w-0">
            <span className="font-label text-[10px] tracking-wider text-on-surface-variant/70 uppercase">{t("dns.name_host")}</span>
            <code className="font-mono text-sm text-on-surface truncate">{record.host}</code>
          </div>
          <CopyButton value={record.host} label={t("dns.name_host")} />
        </div>

        {/* Verdi / Peker til */}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 shadow-[inset_0_1px_0_0_oklch(1_0_0/6%)]">
          <div className="flex flex-col min-w-0">
            <span className="font-label text-[10px] tracking-wider text-on-surface-variant/70 uppercase">{t("dns.value_target")}</span>
            <code className="font-mono text-sm text-primary truncate">{record.value}</code>
          </div>
          <CopyButton value={record.value} label={t("dns.value_target")} />
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Komponent: Tydelig Kopieringsknapp
// -----------------------------------------------------------------------------
function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Fallback
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`${t("dns.copy")} ${label}`}
      className={`ghost-btn shrink-0 flex items-center gap-1.5 px-3 py-1.5 font-label text-xs transition-colors rounded-lg ${
        copied ? "bg-secondary/15 text-secondary font-semibold" : "bg-surface-container text-on-surface-variant hover:text-on-surface"
      }`}
    >
      <span className="material-symbols-outlined icon-sm">
        {copied ? "check" : "content_copy"}
      </span>
      {copied ? t("dns.copied") : t("dns.copy")}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Hjelpefunksjoner for domenenavn
// -----------------------------------------------------------------------------
function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/[^a-z0-9.-]/g, "");
}

function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}
