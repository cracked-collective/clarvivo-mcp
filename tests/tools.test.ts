import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ClarvivoApiError, HttpClarvivoApi, type ClarvivoApi } from "../src/api.js";
import { createToolHandlers } from "../src/tools.js";

function mockApi(overrides: Partial<ClarvivoApi> = {}): ClarvivoApi {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({ id: 1, name: "Example", domain: "example.com", apiKey: "public-key" }),
    getInstallStatus: vi.fn().mockResolvedValue({ installed: false, eventsReceived: 0, lastEventAt: null, locked: false }),
    getAnalytics: vi.fn().mockResolvedValue([]),
    exportData: vi.fn().mockResolvedValue({ data: "", contentType: "text/plain" }),
    getRealtime: vi.fn().mockResolvedValue({ count: 0 }),
    getRevenue: vi.fn().mockResolvedValue({ totalRevenue: 0, eventCount: 0, averageAmount: 0 }),
    connectRevenue: vi.fn().mockResolvedValue({ provider: "stripe", connected: true, webhookUrl: "https://app.clarvivo.com/webhooks/stripe/public-key", secretConfigured: false }),
    getRevenueStatus: vi.fn().mockResolvedValue({ connected: {}, secretConfigured: {}, eventsReceived: 0, lastEventAt: null, lastSource: null, attributedShare: null }),
    createEvent: vi.fn().mockResolvedValue({ id: 1 }),
    listFunnels: vi.fn().mockResolvedValue([]),
    createFunnel: vi.fn().mockResolvedValue({ id: 1, name: "Signup", steps: [] }),
    listAlerts: vi.fn().mockResolvedValue([]),
    createAlert: vi.fn().mockResolvedValue({ id: 1, type: "traffic_spike", threshold: 20, isActive: true }),
    ...overrides,
  };
}

describe("tool error UX", () => {
  it("returns an actionable error for every no-token tool path", async () => {
    const handlers = createToolHandlers({ env: {}, cwd: process.cwd(), api: mockApi() });
    const results = await Promise.all([
      handlers.setupAnalytics({ domain: "example.com", framework: "vite" }),
      handlers.getInstallSnippet({ apiKey: "public", framework: "vite" }),
      handlers.verifyInstallation({ projectId: 1 }),
      handlers.listProjects(),
      handlers.getStats({ projectId: 1, days: 7 }),
      handlers.getTrafficSources({ projectId: 1 }),
      handlers.getPages({ projectId: 1 }),
      handlers.getAudience({ projectId: 1 }),
      handlers.exportData({ projectId: 1, format: "csv" }),
      handlers.connectRevenue({ projectId: 1, provider: "stripe" }),
      handlers.verifyRevenue({ projectId: 1 }),
      handlers.addEvent({ projectId: 1, name: "signup", type: "signup" }),
      handlers.listFunnels({ projectId: 1 }),
      handlers.createFunnel({ projectId: 1, name: "Signup", steps: [{ name: "Start", url: "/" }, { name: "Done", url: "/done" }] }),
      handlers.createAlert({ projectId: 1, type: "traffic_spike", threshold: 20 }),
    ]);
    for (const result of results) {
      expect(result).toMatchObject({ isError: true });
      expect(result.content[0].text).toContain("/dashboard if you are a new user");
      expect(result.content[0].text).toContain("/dashboard/settings?tab=api-tokens if you are a paying user");
      expect(result.content[0].text).toContain("CLARVIVO_API_TOKEN=clv_live_<your-token>");
    }
  });

  it.each([402, 403])("turns HTTP %s project limits into a billing action", async (status) => {
    const api = mockApi({
      createProject: vi.fn().mockRejectedValue(new ClarvivoApiError("forbidden", status)),
    });
    const result = await createToolHandlers({ env: { CLARVIVO_API_TOKEN: "secret" }, cwd: process.cwd(), api })
      .setupAnalytics({ domain: "example.com", framework: "vite" });
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toContain("/dashboard/billing");
    expect(result.content[0].text).toContain("30 seconds");
  });

  it("turns PROJECT_LIMIT_REACHED into a billing action", async () => {
    const api = mockApi({
      createProject: vi.fn().mockRejectedValue(new ClarvivoApiError("limit", 409, "PROJECT_LIMIT_REACHED")),
    });
    const result = await createToolHandlers({ env: { CLARVIVO_API_TOKEN: "secret" }, cwd: process.cwd(), api })
      .setupAnalytics({ domain: "example.com", framework: "vite" });
    expect(result.content[0].text).toContain("/dashboard/billing");
  });

  it("turns a stats 402 into a pay-to-read action", async () => {
    const api = mockApi({
      getAnalytics: vi.fn().mockRejectedValue(new ClarvivoApiError("raw lockout", 402, "TRIAL_EXPIRED")),
    });
    const result = await createToolHandlers({
      env: { CLARVIVO_API_TOKEN: "secret", CLARVIVO_BASE_URL: "https://self.example" },
      api,
    }).getStats({ projectId: 1, days: 7 });
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toContain("Pay $1 to read your Clarvivo data");
    expect(result.content[0].text).toContain("https://self.example/dashboard/billing");
    expect(result.content[0].text).not.toContain("raw lockout");
  });

  it("names the missing token scope and where to add it", async () => {
    const api = mockApi({
      listFunnels: vi.fn().mockRejectedValue(new ClarvivoApiError("scope", 403, "TOKEN_SCOPE_REQUIRED", "funnels:read")),
    });
    const result = await createToolHandlers({ env: { CLARVIVO_API_TOKEN: "secret" }, api }).listFunnels({ projectId: 1 });
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toContain("funnels:read");
    expect(result.content[0].text).toContain("/dashboard/settings?tab=api-tokens");
    expect(result.content[0].text).not.toContain("secret");
  });
});

describe("export_data", () => {
  it.each([
    ["csv" as const, "Date,Visitors\n2026-08-30,4\n2026-08-31,7\n", 2],
    ["json" as const, JSON.stringify({ rowCount: 2, rows: [{ visitors: 4 }, { visitors: 7 }] }), 2],
  ])("writes %s from mocked HTTP and returns metadata without contents", async (format, body, rowCount) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clarvivo-export-"));
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const api = new HttpClarvivoApi({ CLARVIVO_API_TOKEN: "secret", CLARVIVO_BASE_URL: "https://self.example" }, fetchMock);
    const result = await createToolHandlers({ env: { CLARVIVO_API_TOKEN: "secret" }, cwd: root, api })
      .exportData({ projectId: 42, format, path: `report.${format}` });

    expect(result).toMatchObject({ structuredContent: { rowCount, sizeBytes: Buffer.byteLength(body), path: path.join(root, `report.${format}`) } });
    expect(fs.readFileSync(path.join(root, `report.${format}`), "utf8")).toBe(body);
    expect(result.content[0].text).not.toContain(body);
    expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/api/projects/42/export/${format}\\?startDate=`));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses traversal and existing files unless overwrite is explicit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clarvivo-export-safe-"));
    fs.writeFileSync(path.join(root, "existing.csv"), "keep");
    const exportData = vi.fn().mockResolvedValue({ data: "Date,Visitors\n", contentType: "text/csv" });
    const handlers = createToolHandlers({ env: { CLARVIVO_API_TOKEN: "secret" }, cwd: root, api: mockApi({ exportData }) });

    const traversal = await handlers.exportData({ projectId: 1, format: "csv", path: "nested/../escape.csv" });
    expect(traversal).toMatchObject({ isError: true });
    expect(traversal.content[0].text).toContain("traversal");
    const outside = await handlers.exportData({ projectId: 1, format: "csv", path: path.join(os.tmpdir(), "outside.csv") });
    expect(outside).toMatchObject({ isError: true });
    expect(outside.content[0].text).toContain("inside the current working directory");
    const overwrite = await handlers.exportData({ projectId: 1, format: "csv", path: "existing.csv" });
    expect(overwrite).toMatchObject({ isError: true });
    expect(overwrite.content[0].text).toContain("Refusing to overwrite");
    expect(exportData).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, "existing.csv"), "utf8")).toBe("keep");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes a self-contained printable HTML report with no external URLs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clarvivo-report-"));
    const rows = [{
      visitors: 5, pageviews: 9, sessions: 4,
      trafficChannels: { direct: 3, social: 2 },
      pageDetails: [{ path: "/", views: 9, uniqueVisitors: 5, entries: 4, bounceCount: 1, totalDuration: 45 }],
      sourceBreakdown: [{ source: "direct", medium: "(none)", campaign: "(none)", visitors: 3 }],
    }];
    const result = await createToolHandlers({
      env: { CLARVIVO_API_TOKEN: "secret" }, cwd: root,
      api: mockApi({ getAnalytics: vi.fn().mockResolvedValue(rows) }),
    }).exportData({ projectId: "demo", format: "pdf", path: "report.pdf" });

    expect(result).toMatchObject({ structuredContent: { format: "pdf", path: path.join(root, "report.html"), rowCount: 1 } });
    const html = fs.readFileSync(path.join(root, "report.html"), "utf8");
    expect(html).toContain("Traffic channels");
    expect(html).toContain("Top pages");
    expect(html).toContain("Top sources");
    expect(html).not.toMatch(/https?:\/\//i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    [402, "TRIAL_EXPIRED", "Pay $1 to read your Clarvivo data"],
    [403, "FEATURE_NOT_IN_PLAN", "data exports need a paid plan"],
  ])("turns HTTP %s into actionable billing guidance", async (status, code, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "raw", code }), { status }));
    const api = new HttpClarvivoApi({ CLARVIVO_API_TOKEN: "secret", CLARVIVO_BASE_URL: "https://self.example" }, fetchMock);
    const result = await createToolHandlers({
      env: { CLARVIVO_API_TOKEN: "secret", CLARVIVO_BASE_URL: "https://self.example" }, cwd: process.cwd(), api,
    }).exportData({ projectId: 1, format: "csv", path: `never-${status}.csv` });
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toContain(expected);
    expect(result.content[0].text).toContain("https://self.example/dashboard/billing");
    expect(result.content[0].text).not.toContain("raw");
  });
});

describe("setup_analytics", () => {
  it("reuses a domain-equivalent project and never creates a duplicate", async () => {
    const createProject = vi.fn();
    const api = mockApi({
      listProjects: vi.fn().mockResolvedValue([
        { id: 42, name: "Existing", domain: "https://www.Example.com/", apiKey: "existing-public-key" },
      ]),
      createProject,
    });
    const result = await createToolHandlers({ env: { CLARVIVO_API_TOKEN: "do-not-echo" }, cwd: process.cwd(), api })
      .setupAnalytics({ domain: "example.com", framework: "vite" });
    expect(createProject).not.toHaveBeenCalled();
    expect(result).toMatchObject({ structuredContent: { reusedExistingProject: true } });
    expect(result.content[0].text).toContain("existing-public-key");
    expect(result.content[0].text).not.toContain("do-not-echo");
  });
});

describe("verify_installation", () => {
  it("uses proof-of-life status and carries the count plus locked upgrade line", async () => {
    const getAnalytics = vi.fn();
    const getRealtime = vi.fn();
    const getInstallStatus = vi.fn().mockResolvedValue({
      installed: true,
      eventsReceived: 1247,
      lastEventAt: "2026-08-30T10:00:00.000Z",
      locked: true,
      upgradeUrl: "https://app.clarvivo.com/dashboard/billing",
    });
    const result = await createToolHandlers({
      env: { CLARVIVO_API_TOKEN: "secret" },
      api: mockApi({ getInstallStatus, getAnalytics, getRealtime }),
    }).verifyInstallation({ projectId: 42 });

    expect(getInstallStatus).toHaveBeenCalledWith(42);
    expect(getAnalytics).not.toHaveBeenCalled();
    expect(getRealtime).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      structuredContent: {
        installed: true,
        eventsReceived: 1247,
        locked: true,
      },
    });
    expect(result.content[0].text).toContain("1,247 pageviews recorded");
    expect(result.content[0].text).toContain("Pay $1 to read your data");
  });
});

describe("revenue tools", () => {
  it("detects a provider from package.json and never forwards an injected secret", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clarvivo-provider-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { stripe: "^18" } }));
    const connectRevenue = vi.fn().mockResolvedValue({
      provider: "stripe", connected: true, webhookUrl: "https://example.test/webhooks/stripe/key", secretConfigured: false,
    });
    const result = await createToolHandlers({
      env: { CLARVIVO_API_TOKEN: "bearer-do-not-echo" }, cwd: root, api: mockApi({ connectRevenue }),
    }).connectRevenue({ projectId: 7, webhookSecret: "model-injected-secret" });
    fs.rmSync(root, { recursive: true, force: true });

    expect(connectRevenue).toHaveBeenCalledWith(7, "stripe");
    expect(result).toMatchObject({ structuredContent: { provider: "stripe", detectedFrom: "stripe" } });
    expect(result.content[0].text).toContain("checkout.session.completed");
    expect(result.content[0].text).toContain("client_reference_id: clvVid");
    expect(result.content[0].text).not.toContain("model-injected-secret");
    expect(result.content[0].text).not.toContain("bearer-do-not-echo");
  });

  it("warns when events arrive with zero attribution", async () => {
    const result = await createToolHandlers({
      env: { CLARVIVO_API_TOKEN: "secret" },
      api: mockApi({
        getRevenueStatus: vi.fn().mockResolvedValue({
          connected: { stripe: true }, secretConfigured: { stripe: true }, eventsReceived: 3,
          lastEventAt: new Date(Date.now() - 120_000).toISOString(), lastSource: "stripe", attributedShare: 0,
        }),
      }),
    }).verifyRevenue({ projectId: 1 });
    expect(result.content[0].text).toContain("3 events from stripe");
    expect(result.content[0].text).toContain("0% attributed");
    expect(result.content[0].text).toContain("attribution edit is missing");
  });
});

describe("create_funnel", () => {
  it("reuses a same-name funnel and never posts a duplicate", async () => {
    const createFunnel = vi.fn();
    const existing = { id: 9, name: "Signup", steps: [{ name: "Start", url: "/", order: 1 }] };
    const result = await createToolHandlers({
      env: { CLARVIVO_API_TOKEN: "secret" },
      api: mockApi({ listFunnels: vi.fn().mockResolvedValue([existing]), createFunnel }),
    }).createFunnel({ projectId: 1, name: " signup ", steps: [{ name: "Other", url: "/other" }] });
    expect(createFunnel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ structuredContent: { reusedExistingFunnel: true, funnel: existing } });
  });
});
