import path from "node:path";
import {
  type AnalyticsRow,
  type ClarvivoApi,
  HttpClarvivoApi,
  isAnalyticsLockout,
  isPlanLimit,
  payToReadMessage,
  planLimitMessage,
  requireToken,
} from "./api.js";
import {
  detectFramework,
  getInstallInstructions,
  normalizeFramework,
  type FrameworkId,
} from "./frameworks.js";

export interface ToolContext {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  api?: ClarvivoApi;
}

type ToolSuccess = { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> };
type ToolFailure = { content: Array<{ type: "text"; text: string }>; isError: true };
export type ToolResult = ToolSuccess | ToolFailure;

function success(data: Record<string, unknown>): ToolSuccess {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function failure(error: unknown, env: NodeJS.ProcessEnv, mode?: "project-limit" | "analytics-lockout"): ToolFailure {
  const message = mode === "project-limit" && isPlanLimit(error)
    ? planLimitMessage(env.CLARVIVO_BASE_URL)
    : mode === "analytics-lockout" && isAnalyticsLockout(error)
      ? payToReadMessage(env.CLARVIVO_BASE_URL)
      : error instanceof Error ? error.message : "Clarvivo request failed.";
  return { content: [{ type: "text", text: message }], isError: true };
}

function canonicalDomain(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("domain is required.");
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    throw new Error(`"${input}" is not a valid domain. Use a hostname such as example.com.`);
  }
}

function defaultProjectName(domain: string): string {
  return domain.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveApi(context: ToolContext): ClarvivoApi {
  requireToken(context.env ?? process.env);
  return context.api ?? new HttpClarvivoApi(context.env ?? process.env);
}

function baseUrl(context: ToolContext): string {
  return (context.env?.CLARVIVO_BASE_URL || process.env.CLARVIVO_BASE_URL || "https://app.clarvivo.com").replace(/\/$/, "");
}

function projectMatchesDomain(projectDomain: string, domain: string): boolean {
  try {
    return canonicalDomain(projectDomain) === domain;
  } catch {
    return projectDomain.trim().toLowerCase() === domain;
  }
}

function chooseFramework(explicit: string | undefined, cwd: string): { framework: FrameworkId; detection?: ReturnType<typeof detectFramework> } {
  if (explicit) return { framework: normalizeFramework(explicit) };
  const detection = detectFramework(cwd);
  if (!detection) {
    throw new Error("Could not detect the framework. Pass framework explicitly (for example: next-app, vite, astro, or static-html). No project was created.");
  }
  return { framework: detection.framework, detection };
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function topEntries(rows: AnalyticsRow[], keys: ("topPages" | "pageDetails" | "topReferrers")[], labelKeys: string[], valueKeys: string[]): Array<{ name: string; count: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const key of keys) {
      for (const item of array(row[key])) {
        const name = labelKeys.map((candidate) => item[candidate]).find((value) => typeof value === "string") as string | undefined;
        if (!name) continue;
        const count = valueKeys.map((candidate) => item[candidate]).find((value) => value !== undefined);
        totals.set(name, (totals.get(name) ?? 0) + number(count));
      }
    }
  }
  return [...totals.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5);
}

export function summarizeStats(rows: AnalyticsRow[], realtimeCount: number, days: number): Record<string, unknown> {
  const totals = rows.reduce<{ pageviews: number; uniqueVisitors: number; sessions: number }>((acc, row) => ({
    pageviews: acc.pageviews + number(row.pageviews),
    uniqueVisitors: acc.uniqueVisitors + number(row.uniqueVisitors ?? row.visitors),
    sessions: acc.sessions + number(row.sessions),
  }), { pageviews: 0, uniqueVisitors: 0, sessions: 0 });

  const channels = new Map<string, number>();
  for (const row of rows) {
    if (!row.trafficChannels || typeof row.trafficChannels !== "object" || Array.isArray(row.trafficChannels)) continue;
    for (const [name, count] of Object.entries(row.trafficChannels as Record<string, unknown>)) {
      channels.set(name, (channels.get(name) ?? 0) + number(count));
    }
  }

  return {
    days,
    ...totals,
    activeNow: realtimeCount,
    topPages: topEntries(rows, ["topPages", "pageDetails"], ["path", "page"], ["views", "pageviews"]),
    topReferrers: topEntries(rows, ["topReferrers"], ["source", "referrer"], ["visitors", "visits", "count"]),
    trafficChannels: [...channels.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6),
  };
}

export function createToolHandlers(context: ToolContext = {}) {
  const env = context.env ?? process.env;
  const cwd = context.cwd ?? process.cwd();

  return {
    setupAnalytics: async (input: { name?: string; domain: string; framework?: string }): Promise<ToolResult> => {
      try {
        const api = resolveApi(context);
        const domain = canonicalDomain(input.domain);
        const selected = chooseFramework(input.framework, cwd);
        const projects = await api.listProjects();
        let project = projects.find((candidate) => projectMatchesDomain(candidate.domain, domain));
        const reused = Boolean(project);
        if (!project) {
          project = await api.createProject({ name: input.name?.trim() || defaultProjectName(domain), domain });
        }
        const install = getInstallInstructions(selected.framework, project.apiKey, baseUrl(context), cwd);
        return success({
          project: { id: project.id, name: project.name, domain: project.domain, apiKey: project.apiKey },
          reusedExistingProject: reused,
          detection: selected.detection,
          install,
          nextStep: `Edit ${install.file} exactly as described, deploy the site, then run verify_installation with projectId ${project.id}.`,
        });
      } catch (error) {
        return failure(error, env, "project-limit");
      }
    },

    getInstallSnippet: async (input: { apiKey?: string; projectId?: number | string; framework: string }): Promise<ToolResult> => {
      try {
        const api = resolveApi(context);
        let apiKey = input.apiKey?.trim();
        let projectId = input.projectId;
        if (!apiKey) {
          if (projectId === undefined) throw new Error("Provide apiKey or projectId.");
          const project = (await api.listProjects()).find((candidate) => String(candidate.id) === String(projectId));
          if (!project) throw new Error(`Project ${projectId} was not found.`);
          apiKey = project.apiKey;
          projectId = project.id;
        }
        const framework = normalizeFramework(input.framework);
        return success({ projectId, apiKey, install: getInstallInstructions(framework, apiKey, baseUrl(context), cwd) });
      } catch (error) {
        return failure(error, env);
      }
    },

    verifyInstallation: async (input: { projectId: number | string }): Promise<ToolResult> => {
      try {
        const api = resolveApi(context);
        const status = await api.getInstallStatus(input.projectId);
        const count = number(status.eventsReceived);
        const upgradeUrl = status.upgradeUrl || `${baseUrl(context)}/dashboard/billing`;
        const baseMessage = status.installed
          ? `Your tracking is live. ${count.toLocaleString("en-US")} pageviews recorded.`
          : "No real traffic has arrived yet. Deploy the snippet, visit the live site, navigate to another route, wait up to 90 seconds, then run this check again.";
        return success({
          projectId: input.projectId,
          installed: status.installed,
          eventsReceived: count,
          lastEventAt: status.lastEventAt,
          locked: status.locked,
          ...(status.locked ? { upgradeUrl } : {}),
          message: status.locked
            ? `${baseMessage} Pay $1 to read your data: ${upgradeUrl}`
            : baseMessage,
        });
      } catch (error) {
        return failure(error, env, "analytics-lockout");
      }
    },

    listProjects: async (): Promise<ToolResult> => {
      try {
        const projects = await resolveApi(context).listProjects();
        return success({ projects: projects.map(({ id, name, domain, apiKey }) => ({ id, name, domain, apiKey })), count: projects.length });
      } catch (error) {
        return failure(error, env);
      }
    },

    getStats: async (input: { projectId: number | string; days?: number }): Promise<ToolResult> => {
      try {
        const api = resolveApi(context);
        const days = Math.max(1, Math.min(90, Math.round(input.days ?? 7)));
        const [rows, realtime] = await Promise.all([api.getAnalytics(input.projectId, days), api.getRealtime(input.projectId)]);
        return success({ projectId: input.projectId, ...summarizeStats(rows, number(realtime.count), days) });
      } catch (error) {
        return failure(error, env, "analytics-lockout");
      }
    },
  };
}

export function workingDirectoryLabel(cwd = process.cwd()): string {
  return path.basename(cwd) || cwd;
}
