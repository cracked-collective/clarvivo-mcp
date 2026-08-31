import fs from "node:fs";
import path from "node:path";
import {
  type AnalyticsRow,
  ClarvivoApiError,
  type ClarvivoApi,
  HttpClarvivoApi,
  isAnalyticsLockout,
  isPlanLimit,
  exportPlanMessage,
  payToReadMessage,
  planLimitMessage,
  requireToken,
} from "./api.js";
import { aggregateAudience, aggregatePages, aggregateTrafficSources } from "./analytics.js";
import {
  detectFramework,
  getInstallInstructions,
  normalizeFramework,
  type FrameworkId,
} from "./frameworks.js";
import {
  detectRevenueProvider,
  normalizeProvider,
  revenueChecklist,
  signedRevenueSnippet,
} from "./payments.js";
import { generateReportHtml } from "./report.js";

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

function failure(error: unknown, env: NodeJS.ProcessEnv, mode?: "project-limit" | "analytics-lockout" | "export"): ToolFailure {
  const message = error instanceof ClarvivoApiError && error.code === "TOKEN_SCOPE_REQUIRED"
    ? `This tool needs the ${error.scope || "required"} scope. Open ${(env.CLARVIVO_BASE_URL || "https://app.clarvivo.com").replace(/\/$/, "")}/dashboard/settings?tab=api-tokens, add ${error.scope || "that scope"} to this API token (or create a token with it), then restart the MCP client and retry.`
    : mode === "export" && error instanceof ClarvivoApiError && error.status === 403
      ? exportPlanMessage(env.CLARVIVO_BASE_URL)
    : mode === "export" && isAnalyticsLockout(error)
      ? payToReadMessage(env.CLARVIVO_BASE_URL)
    : mode === "project-limit" && isPlanLimit(error)
    ? planLimitMessage(env.CLARVIVO_BASE_URL)
    : mode === "analytics-lockout" && isAnalyticsLockout(error)
      ? payToReadMessage(env.CLARVIVO_BASE_URL)
      : error instanceof Error ? error.message : "Clarvivo request failed.";
  return { content: [{ type: "text", text: message }], isError: true };
}

function reportingDays(input: number | undefined, fallback = 30): number {
  return Math.max(1, Math.min(90, Math.round(input ?? fallback)));
}

function exportPath(cwd: string, requested: string | undefined, projectId: number | string, extension: string): string {
  if (requested?.split(/[\\/]+/).includes("..")) {
    throw new Error("Export path cannot contain '..' traversal.");
  }
  const safeProject = String(projectId).replace(/[^0-9A-Za-z_-]+/g, "-") || "project";
  const date = new Date().toISOString().slice(0, 10);
  let target = requested?.trim() || `clarvivo-export-${safeProject}-${date}.${extension}`;
  if (extension === "html" && path.extname(target).toLowerCase() !== ".html") {
    target = `${target.slice(0, target.length - path.extname(target).length)}.html`;
  }
  const resolvedCwd = path.resolve(cwd);
  const resolved = path.resolve(resolvedCwd, target);
  const relative = path.relative(resolvedCwd, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Export path must stay inside the current working directory.");
  }
  return resolved;
}

function exportedRowCount(format: "csv" | "json", data: string): number {
  if (format === "csv") {
    const lines = data.trimEnd().split(/\r?\n/);
    return Math.max(0, lines.length - 1);
  }
  try {
    const parsed = JSON.parse(data) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Number.isFinite(Number(record.rowCount))) return Number(record.rowCount);
      if (Array.isArray(record.rows)) return record.rows.length;
    }
  } catch {
    // The successful HTTP response is still written verbatim; unknown shapes count as 0.
  }
  return 0;
}

function projectApiKey(projects: Awaited<ReturnType<ClarvivoApi["listProjects"]>>, projectId: number | string): string {
  const project = projects.find((candidate) => String(candidate.id) === String(projectId));
  if (!project) throw new Error(`Project ${projectId} was not found.`);
  return project.apiKey;
}

function relativeTime(value: string | null, now = Date.now()): string {
  if (!value) return "never";
  const elapsed = Math.max(0, now - new Date(value).getTime());
  if (!Number.isFinite(elapsed)) return value;
  const seconds = Math.round(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function knownPagePaths(rows: AnalyticsRow[]): Set<string> {
  const paths = new Set<string>();
  for (const row of rows) {
    for (const item of [...array(row.topPages), ...array(row.pageDetails)]) {
      const value = item.path ?? item.page ?? item.url;
      if (typeof value === "string") paths.add(normalizePath(value));
    }
  }
  return paths;
}

function normalizePath(value: string): string {
  try {
    const parsed = new URL(value, "https://clarvivo.local");
    return parsed.pathname.replace(/\/$/, "") || "/";
  } catch {
    return value.trim().replace(/\/$/, "") || "/";
  }
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
        const [rows, realtime, revenue] = await Promise.all([
          api.getAnalytics(input.projectId, days),
          api.getRealtime(input.projectId),
          api.getRevenue(input.projectId),
        ]);
        return success({
          projectId: input.projectId,
          ...summarizeStats(rows, number(realtime.count), days),
          revenue: {
            total: number(revenue.totalRevenue),
            events: number(revenue.eventCount),
            average: number(revenue.averageAmount),
          },
        });
      } catch (error) {
        return failure(error, env, "analytics-lockout");
      }
    },

    getTrafficSources: async (input: { projectId: number | string; days?: number }): Promise<ToolResult> => {
      try {
        const days = reportingDays(input.days);
        const rows = await resolveApi(context).getAnalytics(input.projectId, days);
        return success({ projectId: input.projectId, days, ...aggregateTrafficSources(rows) });
      } catch (error) {
        return failure(error, env, "analytics-lockout");
      }
    },

    getPages: async (input: { projectId: number | string; days?: number }): Promise<ToolResult> => {
      try {
        const days = reportingDays(input.days);
        const rows = await resolveApi(context).getAnalytics(input.projectId, days);
        return success({ projectId: input.projectId, days, pages: aggregatePages(rows) });
      } catch (error) {
        return failure(error, env, "analytics-lockout");
      }
    },

    getAudience: async (input: { projectId: number | string; days?: number }): Promise<ToolResult> => {
      try {
        const days = reportingDays(input.days);
        const rows = await resolveApi(context).getAnalytics(input.projectId, days);
        return success({ projectId: input.projectId, days, ...aggregateAudience(rows) });
      } catch (error) {
        return failure(error, env, "analytics-lockout");
      }
    },

    exportData: async (input: { projectId: number | string; format: "csv" | "json" | "pdf"; days?: number; path?: string; overwrite?: boolean }): Promise<ToolResult> => {
      try {
        const api = resolveApi(context);
        const days = reportingDays(input.days);
        const extension = input.format === "pdf" ? "html" : input.format;
        const writtenPath = exportPath(cwd, input.path, input.projectId, extension);
        if (!input.overwrite && fs.existsSync(writtenPath)) {
          throw new Error(`Refusing to overwrite existing file: ${writtenPath}. Pass overwrite: true to replace it.`);
        }
        let data: string;
        let rowCount: number;
        if (input.format === "pdf") {
          const rows = await api.getAnalytics(input.projectId, days);
          data = generateReportHtml(input.projectId, days, rows);
          rowCount = rows.length;
        } else {
          const download = await api.exportData(input.projectId, input.format, days);
          data = download.data;
          rowCount = exportedRowCount(input.format, data);
        }
        fs.writeFileSync(writtenPath, data, { encoding: "utf8", flag: input.overwrite ? "w" : "wx" });
        const sizeBytes = Buffer.byteLength(data, "utf8");
        return success({
          projectId: input.projectId,
          format: input.format,
          path: writtenPath,
          rowCount,
          sizeBytes,
          ...(input.format === "pdf" ? { message: "Open this HTML report in a browser and use Print → Save as PDF." } : {}),
        });
      } catch (error) {
        return failure(error, env, "export");
      }
    },

    connectRevenue: async (input: { projectId: number | string; provider?: string; [key: string]: unknown }): Promise<ToolResult> => {
      try {
        const api = resolveApi(context);
        const detected = input.provider ? undefined : detectRevenueProvider(cwd);
        const provider = input.provider ? normalizeProvider(input.provider) : detected?.provider;
        if (!provider || provider === "custom") {
          const apiKey = projectApiKey(await api.listProjects(), input.projectId);
          return success({
            projectId: input.projectId,
            provider: "custom",
            message: "No supported payment SDK was detected. Copy the ingest signing secret from Clarvivo Dashboard → Settings → Integrations into the server-only CLARVIVO_INGEST_SECRET environment variable, then use this signed revenue POST. Never run it in the browser or paste the secret into a tool call.",
            snippet: signedRevenueSnippet(apiKey, baseUrl(context)),
            attribution: "Pass clv_vid from browser localStorage to this server-side code as visitor_id. That is what makes revenue-by-channel work.",
          });
        }
        const connection = await api.connectRevenue(input.projectId, provider);
        const checklist = revenueChecklist(provider, connection.webhookUrl, cwd);
        return success({
          projectId: input.projectId,
          provider,
          detectedFrom: detected?.packageName,
          connected: true,
          secretConfigured: connection.secretConfigured,
          checklist,
          numberedChecklist: checklist.map((item, index) => `${index + 1}. ${item}`).join("\n\n"),
        });
      } catch (error) {
        return failure(error, env);
      }
    },

    verifyRevenue: async (input: { projectId: number | string }): Promise<ToolResult> => {
      try {
        const status = await resolveApi(context).getRevenueStatus(input.projectId);
        const share = status.attributedShare == null ? 0 : Math.round(status.attributedShare * 100);
        const provider = status.lastSource || Object.entries(status.connected).find(([, connected]) => connected)?.[0] || "revenue";
        const summary = `${status.eventsReceived.toLocaleString("en-US")} events from ${provider}, last ${relativeTime(status.lastEventAt)}, ${share}% attributed.`;
        const warning = status.eventsReceived > 0 && share === 0
          ? "Revenue is arriving, but the attribution edit is missing. Add clv_vid and UTM fields to checkout creation so revenue-by-channel works."
          : undefined;
        return success({ projectId: input.projectId, ...status, attributedPercent: share, summary, ...(warning ? { warning } : {}) });
      } catch (error) {
        return failure(error, env);
      }
    },

    addEvent: async (input: { projectId: number | string; name: string; type: string; url?: string; value?: number; where?: string }): Promise<ToolResult> => {
      try {
        const event = await resolveApi(context).createEvent(input.projectId, {
          name: input.name,
          type: input.type,
          ...(input.url ? { url: input.url } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
        });
        const properties = input.value === undefined ? "{}" : `{ value: ${input.value} }`;
        const where = input.where?.trim() || (input.type === "form_submit" || input.type === "signup"
          ? "the successful submit handler, after the server confirms success"
          : input.type === "click" ? "the click handler for the intended control" : "the handler where this action succeeds");
        return success({
          projectId: input.projectId,
          event,
          proposedEdit: `window.clarvivo.trackEvent(${JSON.stringify(input.name)}, ${properties});`,
          placement: `Add the proposed call in ${where}. This tool registered the event in Clarvivo; it did not edit your files.`,
          sdk: "window.clarvivo also exposes trackConversion(value, currency) and trackPurchase(...).",
        });
      } catch (error) {
        return failure(error, env);
      }
    },

    listFunnels: async (input: { projectId: number | string }): Promise<ToolResult> => {
      try {
        const funnels = await resolveApi(context).listFunnels(input.projectId);
        return success({ projectId: input.projectId, funnels, count: funnels.length });
      } catch (error) {
        return failure(error, env);
      }
    },

    createFunnel: async (input: { projectId: number | string; name: string; steps: Array<{ name: string; url: string }> }): Promise<ToolResult> => {
      try {
        const api = resolveApi(context);
        const existing = (await api.listFunnels(input.projectId)).find((funnel) => funnel.name.trim().toLowerCase() === input.name.trim().toLowerCase());
        const ordered = input.steps.map((step, index) => ({ ...step, order: index + 1 }));
        const funnel = existing ?? await api.createFunnel(input.projectId, { name: input.name, steps: ordered });
        const rows = await api.getAnalytics(input.projectId, 90).catch(() => []);
        const pages = knownPagePaths(rows);
        const missingSteps = (existing?.steps ?? ordered)
          .filter((step) => !pages.has(normalizePath(step.url)))
          .map(({ name, url }) => ({ name, url, guidance: "No matching tracked page is visible yet; visit this deployed page or register a matching event." }));
        return success({ projectId: input.projectId, funnel, reusedExistingFunnel: Boolean(existing), missingSteps });
      } catch (error) {
        return failure(error, env);
      }
    },

    createAlert: async (input: { projectId: number | string; type: string; threshold: number }): Promise<ToolResult> => {
      try {
        const api = resolveApi(context);
        const existing = (await api.listAlerts(input.projectId)).find((alert) => alert.type === input.type);
        const alert = existing ?? await api.createAlert(input.projectId, { type: input.type, threshold: input.threshold });
        return success({ projectId: input.projectId, alert, reusedExistingAlert: Boolean(existing) });
      } catch (error) {
        return failure(error, env);
      }
    },
  };
}

export function workingDirectoryLabel(cwd = process.cwd()): string {
  return path.basename(cwd) || cwd;
}
