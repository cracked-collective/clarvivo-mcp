export interface ClarvivoProject {
  id: number | string;
  name: string;
  domain: string;
  apiKey: string;
  [key: string]: unknown;
}

export interface AnalyticsRow {
  date?: string;
  pageviews?: number | string;
  visitors?: number | string;
  uniqueVisitors?: number | string;
  sessions?: number | string;
  topPages?: unknown;
  pageDetails?: unknown;
  topReferrers?: unknown;
  trafficChannels?: unknown;
  [key: string]: unknown;
}

export interface RealtimeSnapshot {
  count?: number;
  [key: string]: unknown;
}

export interface InstallStatus {
  installed: boolean;
  eventsReceived: number;
  lastEventAt: string | null;
  locked: boolean;
  upgradeUrl?: string;
}

export interface ClarvivoApi {
  listProjects(): Promise<ClarvivoProject[]>;
  createProject(input: { name: string; domain: string }): Promise<ClarvivoProject>;
  getInstallStatus(projectId: number | string): Promise<InstallStatus>;
  getAnalytics(projectId: number | string, days: number): Promise<AnalyticsRow[]>;
  getRealtime(projectId: number | string): Promise<RealtimeSnapshot>;
}

export class ClarvivoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ClarvivoApiError";
  }
}

export const DEFAULT_BASE_URL = "https://app.clarvivo.com";

export function tokenSetupMessage(baseUrl = process.env.CLARVIVO_BASE_URL || DEFAULT_BASE_URL): string {
  return `Clarvivo needs an API token. Open ${baseUrl.replace(/\/$/, "")}/dashboard/settings?tab=api-tokens, create a token, then set CLARVIVO_API_TOKEN=clv_live_<your-token> in this MCP server's environment and restart the client.`;
}

export function planLimitMessage(baseUrl = process.env.CLARVIVO_BASE_URL || DEFAULT_BASE_URL): string {
  return `Your Clarvivo plan cannot create another project. Open ${baseUrl.replace(/\/$/, "")}/dashboard/billing — checkout takes about 30 seconds — then re-run setup_analytics.`;
}

export function payToReadMessage(baseUrl = process.env.CLARVIVO_BASE_URL || DEFAULT_BASE_URL): string {
  return `Pay $1 to read your Clarvivo data. Open ${baseUrl.replace(/\/$/, "")}/dashboard/billing, then re-run get_stats.`;
}

export function requireToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.CLARVIVO_API_TOKEN?.trim();
  if (!token) throw new Error(tokenSetupMessage(env.CLARVIVO_BASE_URL || DEFAULT_BASE_URL));
  return token;
}

export class HttpClarvivoApi implements ClarvivoApi {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(env: NodeJS.ProcessEnv = process.env, private readonly fetchImpl: typeof fetch = fetch) {
    this.baseUrl = (env.CLARVIVO_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.token = requireToken(env);
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        Authorization: `Bearer ${this.token}`,
      },
    });

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const object = body && typeof body === "object" ? body as Record<string, unknown> : {};
      throw new ClarvivoApiError(
        typeof object.message === "string" ? object.message : `Clarvivo API request failed (${response.status}).`,
        response.status,
        typeof object.code === "string" ? object.code : undefined,
      );
    }
    return body as T;
  }

  listProjects(): Promise<ClarvivoProject[]> {
    return this.request<ClarvivoProject[]>("/api/projects");
  }

  createProject(input: { name: string; domain: string }): Promise<ClarvivoProject> {
    return this.request<ClarvivoProject>("/api/projects", { method: "POST", body: JSON.stringify(input) });
  }

  getInstallStatus(projectId: number | string): Promise<InstallStatus> {
    return this.request<InstallStatus>(`/api/projects/${encodeURIComponent(String(projectId))}/install-status`);
  }

  getAnalytics(projectId: number | string, days: number): Promise<AnalyticsRow[]> {
    return this.request<AnalyticsRow[]>(`/api/projects/${encodeURIComponent(String(projectId))}/analytics?days=${days}`);
  }

  getRealtime(projectId: number | string): Promise<RealtimeSnapshot> {
    return this.request<RealtimeSnapshot>(`/api/projects/${encodeURIComponent(String(projectId))}/realtime/active`);
  }
}

export function isPlanLimit(error: unknown): boolean {
  return error instanceof ClarvivoApiError && (
    error.code === "PROJECT_LIMIT_REACHED" ||
    error.code === "PAYMENT_REQUIRED_FOR_MORE_PROJECTS" ||
    error.status === 402 ||
    error.status === 403
  );
}

export function isAnalyticsLockout(error: unknown): boolean {
  return error instanceof ClarvivoApiError && error.status === 402;
}
