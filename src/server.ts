import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createToolHandlers } from "./tools.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "clarvivo", version: "0.1.0" });
  const handlers = createToolHandlers();
  const projectId = z.union([z.number(), z.string()]).describe("Clarvivo project ID");

  server.registerTool("setup_analytics", {
    title: "Set up Clarvivo analytics",
    description: "Detect this repository's framework, reuse or create the Clarvivo project for a domain, and return the exact file and code edit. Use this first when asked to add analytics.",
    inputSchema: {
      name: z.string().min(1).optional().describe("Project name; defaults to a readable name derived from domain"),
      domain: z.string().min(1).describe("Production hostname, for example example.com"),
      framework: z.string().min(1).optional().describe("Optional override such as next-app, next-pages, vite, astro, sveltekit, nuxt, remix, gatsby, docusaurus, or static-html"),
    },
    annotations: { idempotentHint: true },
  }, handlers.setupAnalytics);

  server.registerTool("get_install_snippet", {
    title: "Get framework install instructions",
    description: "Return the exact tracking snippet, target file, placement, and framework-specific code for an existing Clarvivo API key or project.",
    inputSchema: {
      apiKey: z.string().min(1).optional().describe("Public Clarvivo tracking API key"),
      projectId: projectId.optional(),
      framework: z.string().min(1).describe("Target framework"),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, handlers.getInstallSnippet);

  server.registerTool("verify_installation", {
    title: "Verify analytics installation",
    description: "Check real analytics and realtime reads to prove that traffic from the deployed site has reached Clarvivo. Does not send synthetic events.",
    inputSchema: { projectId },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, handlers.verifyInstallation);

  server.registerTool("list_projects", {
    title: "List Clarvivo projects",
    description: "List accessible Clarvivo projects with their IDs, domains, and public tracking API keys.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, handlers.listProjects);

  server.registerTool("get_stats", {
    title: "Get compact traffic stats",
    description: "Return a small pre-summarised traffic overview, active visitor count, and top five pages/referrers instead of raw daily analytics rows.",
    inputSchema: {
      projectId,
      days: z.number().int().min(1).max(90).default(7).describe("Reporting window from 1 to 90 days"),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, handlers.getStats);

  return server;
}
