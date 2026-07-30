import { useEffect, useRef, useState } from "react";
import { DeploymentStatusBadge } from "@/components/DeploymentStatusBadge";
import type { Deployment } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase";

/**
 * Live byggelogg for én deployment.
 *
 * Backend skyller loggen til databasen med jevne mellomrom under byggingen, så
 * vi abonnerer på raden i stedet for å polle backend. Sluttstatus kommer inn
 * gjennom det samme abonnementet.
 */
export function DeploymentLogsDialog({
  deployment: initial,
  projectName,
  onClose,
}: {
  deployment: Deployment;
  projectName: string;
  onClose: () => void;
}) {
  const [deployment, setDeployment] = useState(initial);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const channel = getSupabase()
      .channel(`deployment-${initial.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "deployments", filter: `id=eq.${initial.id}` },
        (payload) => setDeployment(payload.new as Deployment),
      )
      .subscribe();

    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [initial.id]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [deployment.logs, autoScroll]);

  const isRunning = deployment.status === "queued" || deployment.status === "building";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-margin-mobile backdrop-blur-sm animate-in fade-in-0 duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logs-title"
      onClick={onClose}
    >
      <div
        className="floating-card flex max-h-[85vh] w-full max-w-3xl flex-col p-8 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-250"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="logs-title" className="font-headline text-headline-md text-on-surface">
              {projectName}
            </h2>
            <p className="mt-1 font-label text-label-md text-on-surface-variant">
              {new Date(deployment.created_at).toLocaleString("nb-NO")}
              {deployment.commit_hash && ` · ${deployment.commit_hash.slice(0, 7)}`}
            </p>
          </div>
          <DeploymentStatusBadge status={deployment.status} />
        </div>

        <pre
          ref={logRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className="min-h-[240px] flex-grow overflow-auto rounded-xl bg-[#070a12] p-5 font-mono text-xs leading-relaxed text-emerald-400 select-text flex flex-col justify-between"
        >
          <div className="whitespace-pre-wrap break-words">{deployment.logs || (isRunning ? "Venter på bygge-motoren…" : "Ingen logg.")}</div>
          {!isRunning && deployment.logs && (
            <div className="mt-4 pt-3 border-t border-emerald-500/20 text-[11px] font-mono text-emerald-300/80 flex items-center justify-between animate-in fade-in-0 duration-300">
              <span>
                {deployment.status === "success"
                  ? "Process finished with exit code 0"
                  : "Process terminated with error code 1"}
              </span>
              <span className="opacity-60">Terminaløkt avsluttet</span>
            </div>
          )}
        </pre>

        <div className="mt-5 flex items-center justify-between gap-3">
          {deployment.url && deployment.status === "success" ? (
            <a
              href={deployment.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 font-body text-body-md text-primary transition-opacity hover:opacity-80"
            >
              <span className="material-symbols-outlined icon-sm">open_in_new</span>
              {deployment.url.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="ghost-btn px-5 py-3 font-label text-label-md"
          >
            Lukk
          </button>
        </div>
      </div>
    </div>
  );
}
