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

export type ExportFormat = "csv" | "json";

export interface ExportDownload {
  data: string;
  contentType: string | null;
}

export interface RealtimeSnapshot {
  count?: number;
  [key: string]: unknown;
}

export interface FunnelStep {
  name: string;
  url: string;
  order: number;
  [key: string]: unknown;
}

export interface ClarvivoFunnel {
  id: number | string;
  name: string;
  steps: FunnelStep[];
  [key: string]: unknown;
}

export interface ClarvivoAlert {
  id: number | string;
  type: string;
  threshold: number | string | null;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface RevenueSummary {
  totalRevenue?: number | string;
  eventCount?: number | string;
  averageAmount?: number | string;
  [key: string]: unknown;
}

export interface RevenueConnection {
  provider: string;
  connected: true;
  webhookUrl: string;
  secretConfigured: boolean;
}

export interface RevenueStatus {
  connected: Record<string, boolean>;
  secretConfigured: Record<string, boolean>;
  eventsReceived: number;
  lastEventAt: string | null;
  lastSource: string | null;
  attributedShare: number | null;
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
  exportData(projectId: number | string, format: ExportFormat, days: number): Promise<ExportDownload>;
  getRealtime(projectId: number | string): Promise<RealtimeSnapshot>;
  getRevenue(projectId: number | string): Promise<RevenueSummary>;
  connectRevenue(projectId: number | string, provider: string): Promise<RevenueConnection>;
  getRevenueStatus(projectId: number | string): Promise<RevenueStatus>;
  createEvent(projectId: number | string, input: { name: string; type: string; url?: string; value?: number }): Promise<Record<string, unknown>>;
  listFunnels(projectId: number | string): Promise<ClarvivoFunnel[]>;
  createFunnel(projectId: number | string, input: { name: string; steps: FunnelStep[] }): Promise<ClarvivoFunnel>;
  listAlerts(projectId: number | string): Promise<ClarvivoAlert[]>;
  createAlert(projectId: number | string, input: { type: string; threshold: number }): Promise<ClarvivoAlert>;
}

export class ClarvivoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly scope?: string,
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

export function exportPlanMessage(baseUrl = process.env.CLARVIVO_BASE_URL || DEFAULT_BASE_URL): string {
  return `Clarvivo data exports need a paid plan. Open ${baseUrl.replace(/\/$/, "")}/dashboard/billing, upgrade, then retry export_data.`;
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

  private async response(pathname: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (response.ok) return response;
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    const object = body && typeof body === "object" ? body as Record<string, unknown> : {};
    throw new ClarvivoApiError(
      typeof object.message === "string" ? object.message : `Clarvivo API request failed (${response.status}).`,
      response.status,
      typeof object.code === "string" ? object.code : undefined,
      typeof object.scope === "string" ? object.scope : undefined,
    );
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await this.response(pathname, init);
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
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

  async exportData(projectId: number | string, format: ExportFormat, days: number): Promise<ExportDownload> {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    const query = new URLSearchParams({
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString(),
    });
    const response = await this.response(
      `/api/projects/${encodeURIComponent(String(projectId))}/export/${format}?${query}`,
    );
    return { data: await response.text(), contentType: response.headers.get("content-type") };
  }

  getRealtime(projectId: number | string): Promise<RealtimeSnapshot> {
    return this.request<RealtimeSnapshot>(`/api/projects/${encodeURIComponent(String(projectId))}/realtime/active`);
  }

  getRevenue(projectId: number | string): Promise<RevenueSummary> {
    return this.request<RevenueSummary>(`/api/projects/${encodeURIComponent(String(projectId))}/revenue`);
  }

  connectRevenue(projectId: number | string, provider: string): Promise<RevenueConnection> {
    return this.request<RevenueConnection>(`/api/projects/${encodeURIComponent(String(projectId))}/revenue-connection`, {
      method: "PUT",
      body: JSON.stringify({ provider, connected: true }),
    });
  }

  getRevenueStatus(projectId: number | string): Promise<RevenueStatus> {
    return this.request<RevenueStatus>(`/api/projects/${encodeURIComponent(String(projectId))}/revenue-status`);
  }

  createEvent(projectId: number | string, input: { name: string; type: string; url?: string; value?: number }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/projects/${encodeURIComponent(String(projectId))}/events`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listFunnels(projectId: number | string): Promise<ClarvivoFunnel[]> {
    return this.request<ClarvivoFunnel[]>(`/api/projects/${encodeURIComponent(String(projectId))}/funnels`);
  }

  createFunnel(projectId: number | string, input: { name: string; steps: FunnelStep[] }): Promise<ClarvivoFunnel> {
    return this.request<ClarvivoFunnel>(`/api/projects/${encodeURIComponent(String(projectId))}/funnels`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listAlerts(projectId: number | string): Promise<ClarvivoAlert[]> {
    return this.request<ClarvivoAlert[]>(`/api/projects/${encodeURIComponent(String(projectId))}/alerts`);
  }

  createAlert(projectId: number | string, input: { type: string; threshold: number }): Promise<ClarvivoAlert> {
    return this.request<ClarvivoAlert>(`/api/projects/${encodeURIComponent(String(projectId))}/alerts`, {
      method: "POST",
      body: JSON.stringify(input),
    });
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
