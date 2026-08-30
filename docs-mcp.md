# Install Clarvivo from your coding agent

Add privacy-friendly analytics to an app in about 60 seconds—without leaving Cursor, Claude Code, Codex CLI, or another MCP client.

## 1. Connect Clarvivo

Create an API token at [app.clarvivo.com/dashboard/settings?tab=api-tokens](https://app.clarvivo.com/dashboard/settings?tab=api-tokens), then install the MCP server in your coding client:

```json
{
  "mcpServers": {
    "clarvivo": {
      "command": "npx",
      "args": ["-y", "clarvivo-mcp"],
      "env": {
        "CLARVIVO_API_TOKEN": "clv_live_REPLACE_ME"
      }
    }
  }
}
```

See the [`clarvivo-mcp` README](../mcp/README.md) for Claude Code, Cursor, Codex CLI, Windsurf, Cline, VS Code, and Zed-specific formats.

## 2. Ask your agent

> Set up Clarvivo analytics for `example.com`, make the required code edit, and tell me when it is ready to deploy.

The agent detects Next.js, Vite, Astro, SvelteKit, Nuxt, Remix / React Router, Gatsby, Docusaurus, Create React App, or static HTML. It reuses an existing Clarvivo project for the domain—never silently creating a duplicate—or creates one and returns the exact target file and code.

Next.js uses `next/script` with `strategy="afterInteractive"`. Other frameworks receive the correct shared layout, app template, config, or HTML edit.

## 3. Deploy and verify

Deploy normally, visit the live site, and ask:

> Verify the Clarvivo installation.

Verification reads real analytics and realtime traffic. It does not send a synthetic event, so a successful result proves the deployed site is actually reporting.

Client-side navigation is automatic. The tracker observes `history.pushState`, `history.replaceState`, and `popstate`, so SPAs do not need router hooks.

Afterward, ask for “Clarvivo stats for the last 7 days.” The MCP server returns a compact summary rather than dumping raw daily analytics into the model context.

Clarvivo has no free tier. If the account cannot create another project, the agent gives you the [billing link](https://app.clarvivo.com/dashboard/billing); checkout takes about 30 seconds, then you can rerun setup.
