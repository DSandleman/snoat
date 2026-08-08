import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { DashboardNav } from "@/components/DashboardNav";

import { DeploymentStatusBadge } from "@/components/DeploymentStatusBadge";
import { useDeploymentsRealtime } from "@/hooks/useDeploymentsRealtime";
import {
  deployProject,
  getGithubStatus,
  listGithubRepos,
  type GithubRepo,
  type GithubStatus,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Deployment, Project, ProjectWithLatestDeployment } from "@/lib/database.types";
import { appDomainSuffix } from "@/lib/platform";
import { getSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [{ title: "Mine prosjekter — Snoat" }, { name: "robots", content: "noindex" }],
  }),
  component: DashboardPage,
});

async function fetchProjects(): Promise<ProjectWithLatestDeployment[]> {
  const { data, error } = await getSupabase()
    .from("projects")
    .select("*, deployments(*)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const { deployments, ...project } = row as Project & { deployments: Deployment[] };
    const latest = [...(deployments ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )[0];
    return { ...project, latestDeployment: latest ?? null };
  });
}

function DashboardPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/login" });
  }, [loading, user, navigate]);

  const projects = useQuery({
    queryKey: ["projects", user?.id],
    queryFn: fetchProjects,
    enabled: Boolean(user),
  });

  useDeploymentsRealtime(Boolean(user));

  const [creating, setCreating] = useState(false);
  const [githubNotice, setGithubNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("github");
    if (!result) return;

    setGithubNotice(
      result === "connected"
        ? t("dashboard.github_connected")
        : t("dashboard.github_failed"),
    );
    void queryClient.invalidateQueries({ queryKey: ["github-status"] });
    window.history.replaceState(null, "", window.location.pathname);
  }, [queryClient, t]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-body text-body-md text-on-surface-variant">{t("login.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-container-max flex-grow px-margin-mobile py-stack-lg md:px-gutter">
        <div className="mb-stack-md flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-headline-lg text-on-background">{t("dashboard.title")}</h1>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="primary-btn px-6 py-3 font-label text-label-md"
          >
            {t("dashboard.new_project")}
          </button>
        </div>

        {githubNotice && (
          <div
            role="status"
            className="mb-stack-md flex items-center justify-between gap-4 rounded-xl bg-surface-container px-5 py-4 animate-in fade-in-50 slide-in-from-top-2 duration-300"
          >
            <p className="font-body text-body-md text-on-surface-variant">{githubNotice}</p>
            <button
              type="button"
              onClick={() => setGithubNotice(null)}
              aria-label={t("dashboard.close_notice")}
              className="font-label text-label-md text-on-surface-variant/70 transition-opacity hover:opacity-70"
            >
              {t("dashboard.close_notice")}
            </button>
          </div>
        )}

        {projects.isLoading && (
          <p className="font-body text-body-md text-on-surface-variant">{t("dashboard.loading")}</p>
        )}

        {projects.isError && (
          <div className="floating-card p-8">
            <h2 className="mb-2 font-headline text-headline-md text-on-surface">
              {t("dashboard.error_title")}
            </h2>
            <p className="font-body text-body-md text-error">{projects.error.message}</p>
          </div>
        )}

        {projects.isSuccess && projects.data.length === 0 && (
          <EmptyState onCreate={() => setCreating(true)} />
        )}

        {projects.isSuccess && projects.data.length > 0 && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projects.data.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </main>

      {creating && <NewProjectDialog userId={user.id} onClose={() => setCreating(false)} />}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <h2 className="mb-2 font-headline text-headline-md text-on-surface">{t("dashboard.empty_title")}</h2>
      <p className="mb-8 max-w-md font-body text-body-md text-on-surface-variant">
        {t("dashboard.empty_desc")}
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="primary-btn px-8 py-3.5 font-label text-label-md"
      >
        {t("dashboard.empty_cta")}
      </button>
    </div>
  );
}

function ProjectFavicon({ url, repoUrl }: { url: string | null; repoUrl: string }) {
  const [imgSrc, setImgSrc] = useState<string | null>(() => {
    if (url) {
      return `${url.replace(/\/$/, "")}/favicon.ico`;
    }
    const owner = repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").split("/")[0];
    return owner ? `https://github.com/${owner}.png?size=64` : null;
  });
  const [failed, setFailed] = useState(false);

  const handleNextFallback = () => {
    if (url && imgSrc?.includes("/favicon.ico")) {
      const owner = repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").split("/")[0];
      if (owner) {
        setImgSrc(`https://github.com/${owner}.png?size=64`);
        return;
      }
    }
    setFailed(true);
  };

  if (!imgSrc || failed) {
    return (
      <span className="material-symbols-outlined icon-sm text-on-surface-variant shrink-0">
        public
      </span>
    );
  }

  return (
    <img
      src={imgSrc}
      alt=""
      className="h-5 w-5 rounded-sm object-contain shrink-0"
      onError={handleNextFallback}
    />
  );
}

function ProjectCard({ project }: { project: ProjectWithLatestDeployment }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const deployment = project.latestDeployment;
  const repoLabel = project.repo_url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "");

  const isBuilding = deployment?.status === "queued" || deployment?.status === "building";
  /** Appen er slått av. Statusen ligger på prosjektet, ikke på deploymenten. */
  const isStopped = Boolean(project.stopped_at);

  // En stoppet app har ingen adresse som svarer. Lenken skjules derfor, i stedet
  // for å sende brukeren til en 502.
  const displayUrl = deployment?.url && !isStopped ? deployment.url.replace(/^https?:\/\//, "") : null;
  const activeUrl = deployment?.url && !isStopped ? deployment.url : null;

  const deploy = useMutation({
    mutationFn: () => deployProject(project.id),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      void navigate({
        to: "/projects/$projectId",
        params: { projectId: project.id },
        search: { tab: "terminal" },
      });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  return (
    <article
      onClick={() => {
        void navigate({
          to: "/projects/$projectId",
          params: { projectId: project.id },
        });
      }}
      className="floating-card flex cursor-pointer flex-col gap-4 p-6 transition-all"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <ProjectFavicon url={activeUrl} repoUrl={project.repo_url} />
          <h3 className="font-headline text-headline-md text-on-surface truncate">
            {project.name}
          </h3>
        </div>
        <DeploymentStatusBadge status={deployment?.status ?? null} stopped={isStopped} />
      </div>

      {error && (
        <p role="alert" className="font-body text-body-md text-error">
          {error}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-3">
        {deployment?.url ? (
          <a
            href={deployment.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high/60 hover:bg-surface-container-high px-3.5 py-1.5 font-body text-body-sm font-medium text-primary hover:text-primary transition-all border border-primary/20 hover:border-primary/40"
          >
            <span className="material-symbols-outlined icon-sm">link</span>
            <span className="truncate max-w-[150px] sm:max-w-[180px]">{displayUrl}</span>
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high/30 px-3.5 py-1.5 font-body text-body-sm text-on-surface-variant/60">
            <span className="material-symbols-outlined icon-sm">link_off</span>
            {t("dashboard.no_url")}
          </span>
        )}

        <div className="flex items-center gap-2">
          {project.repo_url && (
            <a
              href={project.repo_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={repoLabel}
              className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-surface-container-high/60 hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-all border border-surface-container-high/80"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deploy.mutate();
            }}
            disabled={deploy.isPending || isBuilding}
            className="primary-btn px-4 py-2 font-label text-label-md disabled:opacity-50"
          >
            {isBuilding
              ? t("dashboard.deploying")
              : isStopped
                ? t("dashboard.start")
                : deployment
                  ? t("dashboard.redeploy")
                  : t("dashboard.deploy")}
          </button>
        </div>
      </div>
    </article>
  );
}

function slugFromRepoUrl(repoUrl: string): string {
  const last =
    repoUrl
      .trim()
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean)
      .pop() ?? "";
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function RepoPicker({
  status,
  repos,
  isLoading,
  error,
  search,
  onSearch,
  selectedUrl,
  onSelect,
}: {
  status: GithubStatus | undefined;
  repos: GithubRepo[];
  isLoading: boolean;
  error: Error | null;
  search: string;
  onSearch: (value: string) => void;
  selectedUrl: string;
  onSelect: (repo: GithubRepo) => void;
}) {
  const { t } = useTranslation();
  if (!status?.connected) {
    return (
      <div className="rounded-xl bg-surface-container px-4 py-5 text-center">
        <p className="mb-4 font-body text-body-md text-on-surface-variant">
          {t("dashboard.new_project_modal.connect_github_prompt")}
        </p>
        <a
          href={status?.installUrl ?? "#"}
          className="primary-btn inline-flex px-5 py-2.5 font-label text-label-md"
        >
          {t("dashboard.new_project_modal.connect_github")}
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={t("dashboard.new_project_modal.search_placeholder")}
        className="rounded-xl bg-surface-container px-4 py-3 font-body text-body-md text-on-surface outline-none ring-primary/60 placeholder:text-on-surface-variant/60 focus:ring-2"
      />

      <div className="max-h-56 overflow-y-auto rounded-xl bg-surface-container/60">
        {isLoading && (
          <p className="px-4 py-4 font-body text-body-md text-on-surface-variant">
            {t("dashboard.new_project_modal.loading_repos")}
          </p>
        )}

        {error && (
          <p role="alert" className="px-4 py-4 font-body text-body-md text-error">
            {error.message}
          </p>
        )}

        {!isLoading && !error && repos.length === 0 && (
          <p className="px-4 py-4 font-body text-body-md text-on-surface-variant">
            {t("dashboard.new_project_modal.no_repos")}{" "}
            <a href={status.installUrl ?? "#"} className="text-primary hover:opacity-80">
              {t("dashboard.new_project_modal.grant_access")}
            </a>
            .
          </p>
        )}

        {repos.map((repo) => {
          const selected = repo.cloneUrl === selectedUrl;
          return (
            <button
              key={repo.id}
              type="button"
              onClick={() => onSelect(repo)}
              aria-pressed={selected}
              className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                selected ? "bg-primary/15" : "hover:bg-surface-container"
              }`}
            >
              <span className="truncate font-body text-body-md text-on-surface">
                {repo.fullName}
              </span>
              {repo.private && (
                <span className="shrink-0 rounded bg-surface-variant/50 px-2 py-0.5 font-label text-label-md text-on-surface-variant/70">
                  {t("dashboard.new_project_modal.private")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NewProjectDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [repoUrl, setRepoUrl] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [search, setSearch] = useState("");
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [pasteUrl, setPasteUrl] = useState(false);

  const status = useQuery({ queryKey: ["github-status"], queryFn: getGithubStatus });
  const repos = useQuery({
    queryKey: ["github-repos"],
    queryFn: listGithubRepos,
    enabled: status.data?.connected === true,
  });

  const showPicker = status.data?.configured === true && !pasteUrl;

  const filtered = (repos.data?.repos ?? []).filter((repo) =>
    repo.fullName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const effectiveName = nameTouched ? name : slugFromRepoUrl(repoUrl);

  const selectRepo = (repo: GithubRepo) => {
    setRepoUrl(repo.cloneUrl);
    setInstallationId(repo.installationId);
  };

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await getSupabase().from("projects").insert({
        user_id: userId,
        name: effectiveName,
        repo_url: repoUrl.trim(),
        github_installation_id: installationId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-margin-mobile backdrop-blur-sm animate-in fade-in-0 duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
      onClick={onClose}
    >
      <div
        className="floating-card w-full max-w-lg p-8 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-250"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="new-project-title" className="mb-2 font-headline text-headline-md text-on-surface">
          {t("dashboard.new_project_modal.title")}
        </h2>
        <p className="mb-stack-md font-body text-body-md text-on-surface-variant">
          {t("dashboard.new_project_modal.desc")}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-label text-label-md text-on-surface-variant">
                {t("dashboard.new_project_modal.github_repo")}
              </span>
              {status.data?.configured && (
                <button
                  type="button"
                  onClick={() => {
                    setPasteUrl(!pasteUrl);
                    setRepoUrl("");
                    setInstallationId(null);
                  }}
                  className="font-label text-label-md text-primary transition-opacity hover:opacity-80"
                >
                  {pasteUrl ? t("dashboard.new_project_modal.choose_list") : t("dashboard.new_project_modal.paste_url")}
                </button>
              )}
            </div>

            {showPicker ? (
              <RepoPicker
                status={status.data}
                repos={filtered}
                isLoading={repos.isLoading}
                error={repos.error}
                search={search}
                onSearch={setSearch}
                selectedUrl={repoUrl}
                onSelect={selectRepo}
              />
            ) : (
              <input
                type="url"
                required
                value={repoUrl}
                onChange={(event) => {
                  setRepoUrl(event.target.value);
                  setInstallationId(null);
                }}
                placeholder="https://github.com/brukernavn/repo"
                className="rounded-xl bg-surface-container px-4 py-3 font-body text-body-md text-on-surface outline-none ring-primary/60 placeholder:text-on-surface-variant/60 focus:ring-2"
              />
            )}

            {!installationId && repoUrl && (
              <span className="font-label text-label-md text-on-surface-variant/70">
                {t("dashboard.new_project_modal.public_repo_note")}
              </span>
            )}
          </div>

          <label className="flex flex-col gap-2">
            <span className="font-label text-label-md text-on-surface-variant">
              {t("dashboard.new_project_modal.project_name")}
            </span>
            <input
              type="text"
              required
              value={effectiveName}
              onChange={(event) => {
                setNameTouched(true);
                setName(event.target.value);
              }}
              pattern="[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?"
              title="Små bokstaver, tall og bindestrek."
              placeholder="min-app"
              className="rounded-xl bg-surface-container px-4 py-3 font-body text-body-md text-on-surface outline-none ring-primary/60 placeholder:text-on-surface-variant/60 focus:ring-2"
            />
            <span className="font-label text-label-md text-on-surface-variant/70">
              {t("dashboard.new_project_modal.subdomain_preview", {
                name: effectiveName || "<navn>",
                suffix: appDomainSuffix,
              })}
            </span>
          </label>

          {create.isError && (
            <p role="alert" className="font-body text-body-md text-error">
              {create.error.message}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="ghost-btn px-5 py-3 font-label text-label-md"
            >
              {t("dashboard.new_project_modal.cancel")}
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="primary-btn px-6 py-3 font-label text-label-md disabled:opacity-50"
            >
              {create.isPending ? t("dashboard.new_project_modal.creating") : t("dashboard.new_project_modal.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
