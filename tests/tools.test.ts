import { describe, expect, it, vi } from "vitest";
import { ClarvivoApiError, type ClarvivoApi } from "../src/api.js";
import { createToolHandlers } from "../src/tools.js";

function mockApi(overrides: Partial<ClarvivoApi> = {}): ClarvivoApi {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({ id: 1, name: "Example", domain: "example.com", apiKey: "public-key" }),
    getAnalytics: vi.fn().mockResolvedValue([]),
    getRealtime: vi.fn().mockResolvedValue({ count: 0 }),
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
    ]);
    for (const result of results) {
      expect(result).toMatchObject({ isError: true });
      expect(result.content[0].text).toContain("/dashboard/settings?tab=api-tokens");
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
