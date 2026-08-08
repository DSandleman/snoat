import type { DeploymentStatus } from "@/lib/database.types";

const presentation: Record<
  DeploymentStatus | "none",
  { label: string; dot: string; text: string }
> = {
  success: { label: "Live", dot: "bg-secondary", text: "text-secondary" },
  building: { label: "Bygger", dot: "bg-primary animate-pulse", text: "text-primary" },
  queued: { label: "I kø", dot: "bg-on-surface-variant", text: "text-on-surface-variant" },
  failed: { label: "Feilet", dot: "bg-error", text: "text-error" },
  none: { label: "Ikke deployet", dot: "bg-surface-variant", text: "text-on-surface-variant" },
};

export function DeploymentStatusBadge({
  status,
  isLive = true,
  stopped = false,
  stopping = false,
}: {
  status: DeploymentStatus | null;
  isLive?: boolean;
  /** Prosjektet er slått av (`projects.stopped_at`). */
  stopped?: boolean;
  /** Stopp-forespørselen pågår akkurat nå. */
  stopping?: boolean;
}) {
  let info = presentation[status ?? "none"];

  if (status === "success" && !isLive) {
    info = {
      label: "Fullført",
      dot: "bg-on-surface-variant/60",
      text: "text-on-surface-variant",
    };
  }

  // Rekkefølgen er meningsbærende.
  //
  // «Stenger» er en pågående handling brukeren nettopp startet, og skal vises
  // uansett hva den siste deploymenten sier. «Stoppet» viker derimot for et bygg
  // som pågår: starter man en ny deployment på et stoppet prosjekt, er «Bygger»
  // det riktige svaret – backend nullstiller `stopped_at` i samme øyeblikk.
  if (stopping) {
    info = { label: "Stenger …", dot: "bg-on-surface-variant animate-pulse", text: "text-on-surface-variant" };
  } else if (stopped && status !== "building" && status !== "queued") {
    info = { label: "Stoppet", dot: "bg-on-surface-variant/60", text: "text-on-surface-variant" };
  }

  const { label, dot, text } = info;

  if (label === "Live") {
    return (
      <span className="font-label text-label-md text-secondary underline decoration-secondary underline-offset-4 font-semibold px-1">
        Live
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-surface-container px-3 py-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className={`font-label text-label-md ${text}`}>{label}</span>
    </span>
  );
}
