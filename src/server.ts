import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createToolHandlers } from "./tools.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "clarvivo", version: "0.3.1" });
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
    description: "Check Clarvivo's proof-of-life receipt to confirm that traffic from the deployed site has arrived, without reading analytics or sending synthetic events.",
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

  server.registerTool("get_traffic_sources", {
    title: "Get traffic sources",
    description: "Aggregate the selected analytics window into compact traffic-channel shares, the top ten referrers, and the top ten UTM source/medium/campaign rows. Never returns raw daily rows.",
    inputSchema: {
      projectId,
      days: z.number().int().min(1).max(90).default(30).describe("Reporting window from 1 to 90 days"),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, handlers.getTrafficSources);

  server.registerTool("get_pages", {
    title: "Get top pages",
    description: "Aggregate page analytics and return only the top ten pages by views, including known visitor, entry, exit, bounce, and average-time metrics.",
    inputSchema: {
      projectId,
      days: z.number().int().min(1).max(90).default(30).describe("Reporting window from 1 to 90 days"),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, handlers.getPages);

  server.registerTool("get_audience", {
    title: "Get audience breakdown",
    description: "Return compact device, browser, OS, country, visitor-segment, screen-resolution, and language aggregates for the selected window.",
    inputSchema: {
      projectId,
      days: z.number().int().min(1).max(90).default(30).describe("Reporting window from 1 to 90 days"),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, handlers.getAudience);

  server.registerTool("export_data", {
    title: "Export analytics data",
    description: "Write a CSV or JSON analytics export to a safe local path, or write a self-contained printable HTML report for saving as PDF. Returns file metadata, never file contents.",
    inputSchema: {
      projectId,
      format: z.enum(["csv", "json", "pdf"]),
      days: z.number().int().min(1).max(90).default(30).describe("Reporting window from 1 to 90 days"),
      path: z.string().min(1).optional().describe("Destination inside the current working directory"),
      overwrite: z.boolean().default(false).describe("Replace an existing destination file"),
    },
  }, handlers.exportData);

  server.registerTool("connect_revenue", {
    title: "Connect payment revenue",
    description: "Detect a supported payment SDK (or use the named provider), connect its Clarvivo webhook, and return a three-step setup checklist with the exact attribution edit. Never accepts or transmits webhook secrets.",
    inputSchema: {
      projectId,
      provider: z.enum(["stripe", "polar", "razorpay", "paddle", "lemonsqueezy", "dodo", "custom"]).optional(),
    },
    annotations: { idempotentHint: true },
  }, handlers.connectRevenue);

  server.registerTool("verify_revenue", {
    title: "Verify payment revenue",
    description: "Check payment webhook proof-of-life and attribution coverage without returning revenue amounts or customer data.",
    inputSchema: { projectId },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, handlers.verifyRevenue);

  server.registerTool("add_event", {
    title: "Register a tracked event",
    description: "Register a Clarvivo event and propose the exact window.clarvivo.trackEvent call and handler placement. This tool does not edit files.",
    inputSchema: {
      projectId,
      name: z.string().min(1),
      type: z.enum(["click", "form_submit", "page_view", "purchase", "signup", "custom"]),
      url: z.string().min(1).optional(),
      value: z.number().finite().optional(),
      where: z.string().min(1).optional().describe("Human-readable handler or file location for the proposed edit"),
    },
  }, handlers.addEvent);

  server.registerTool("create_funnel", {
    title: "Create a conversion funnel",
    description: "Create an ordered funnel, reusing a case-insensitive name match so retries never duplicate it, and flag steps without a known tracked page.",
    inputSchema: {
      projectId,
      name: z.string().min(1),
      steps: z.array(z.object({ name: z.string().min(1), url: z.string().min(1) })).min(2),
    },
    annotations: { idempotentHint: true },
  }, handlers.createFunnel);

  server.registerTool("create_alert", {
    title: "Create an analytics alert",
    description: "Create a traffic or conversion alert, reusing an existing alert of the same type.",
    inputSchema: {
      projectId,
      type: z.enum(["traffic_spike", "traffic_dip", "conversion_drop"]),
      threshold: z.number().finite().nonnegative(),
    },
    annotations: { idempotentHint: true },
  }, handlers.createAlert);

  server.registerTool("list_funnels", {
    title: "List conversion funnels",
    description: "List the project's funnels and ordered steps.",
    inputSchema: { projectId },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, handlers.listFunnels);

  return server;
}
