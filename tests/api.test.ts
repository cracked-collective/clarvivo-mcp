import { describe, expect, it, vi } from "vitest";
import { ClarvivoApiError, HttpClarvivoApi } from "../src/api.js";

describe("HttpClarvivoApi", () => {
  it("uses the configured base URL and bearer auth without putting the token in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const api = new HttpClarvivoApi(
      { CLARVIVO_API_TOKEN: "top-secret", CLARVIVO_BASE_URL: "http://127.0.0.1:5000/" },
      fetchMock,
    );
    await api.listProjects();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:5000/api/projects",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer top-secret" }) }),
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain("top-secret");
  });

  it("preserves status and PROJECT_LIMIT_REACHED from a mocked HTTP response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "limit", code: "PROJECT_LIMIT_REACHED" }),
      { status: 403 },
    ));
    const api = new HttpClarvivoApi({ CLARVIVO_API_TOKEN: "secret" }, fetchMock);
    await expect(api.createProject({ name: "Example", domain: "example.com" }))
      .rejects.toEqual(expect.objectContaining<Partial<ClarvivoApiError>>({ status: 403, code: "PROJECT_LIMIT_REACHED" }));
  });
});
