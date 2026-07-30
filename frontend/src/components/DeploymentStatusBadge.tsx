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

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus | null }) {
  const { label, dot, text } = presentation[status ?? "none"];

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-surface-container px-3 py-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className={`font-label text-label-md ${text}`}>{label}</span>
    </span>
  );
}
