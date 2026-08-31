# `@clarvivo/mcp`

Install Clarvivo analytics without leaving your coding agent. The server detects the app framework, reuses or creates the right Clarvivo project, and returns the exact file and code edit. It can then verify real traffic, connect payment revenue, and configure events, funnels, and alerts.

## The 60-second flow

1. Create an API token at [app.clarvivo.com/dashboard/settings?tab=api-tokens](https://app.clarvivo.com/dashboard/settings?tab=api-tokens).
2. Add this MCP server to your coding client with `CLARVIVO_API_TOKEN` in its environment.
3. Ask the agent: **“Set up Clarvivo analytics for `example.com`.”**
4. The agent detects the framework, calls `setup_analytics`, makes the returned edit, and deploys through your normal workflow.
5. Visit the deployed site, then ask the agent to verify the installation.

The tracker observes `history.pushState`, `history.replaceState`, and `popstate`, so client-side SPA route changes work automatically. Do not add router hooks.

## Tools

| Tool | Purpose |
| --- | --- |
| `setup_analytics` | Detect the framework, reuse a matching-domain project or create one, and return the exact installation edit. |
| `get_install_snippet` | Get framework-specific instructions for an existing API key or project. |
| `verify_installation` | Prove the deployed snippet works from a proof-of-life event count, without reading analytics. |
| `list_projects` | List accessible projects and their public tracking API keys. |
| `get_stats` | Return a small traffic and top-line revenue summary for 1–90 days, capped to the top five pages and referrers. |
| `get_traffic_sources` | Aggregate up to 90 days into channel shares, the top ten referrers, and the top ten UTM source rows. |
| `get_pages` | Return the top ten pages with visitors, entries, exits, bounce rate, and average time. |
| `get_audience` | Summarise devices, browsers, operating systems, countries, visitor segments, screens, and languages. |
| `export_data` | Write CSV/JSON locally, or create a self-contained printable HTML report for PDF; return metadata only. |
| `connect_revenue` | Detect Stripe, Polar, Razorpay, Paddle, Lemon Squeezy, or Dodo; connect its webhook; and return the attribution edit. |
| `verify_revenue` | Summarise webhook proof-of-life and attribution coverage without dumping payment data. |
| `add_event` | Register an event and propose the `window.clarvivo.trackEvent(...)` edit and handler placement. |
| `create_funnel` | Create an ordered funnel or reuse one with the same name, then flag unmatched steps. |
| `create_alert` | Create a traffic/conversion alert or reuse an alert of the same type. |
| `list_funnels` | List funnels and their ordered steps. |

`setup_analytics` supports Next.js App Router, Next.js Pages Router, Vite (React/Vue/Svelte), Create React App, Astro, SvelteKit, Nuxt, Remix / React Router v7, Gatsby, Docusaurus, and static HTML.

## Read your data

Ask for a quick overview with `get_stats`, then use `get_traffic_sources`, `get_pages`, or `get_audience` when you need a focused breakdown. These tools aggregate the full reporting window inside the MCP server, cap every returned list, and never place raw daily analytics rows into the model context. Their default window is 30 days and accepts 1–90 days.

Analytics reads require the `analytics:read` token scope. If the account is still awaiting its first payment or its access has lapsed, the tools stop at the same billing wall as the dashboard and link to the billing page.

## Export

`export_data` writes the result to disk instead of returning file contents. CSV and JSON use Clarvivo's paid export routes; `pdf` creates a slim, self-contained `.html` report with headline metrics, channels, top pages, and sources. Open that file in a browser and use **Print → Save as PDF**, matching the dashboard workflow.

The default filename is `clarvivo-export-<project>-<date>.<ext>` in the current working directory. A custom `path` must remain inside that directory and cannot contain `..`. Existing files are protected unless `overwrite: true` is passed. Data export remains plan-gated and uses the existing `analytics:read` scope.

## Connect payments

1. Ask the agent: **“Connect Clarvivo revenue for this project.”**
2. `connect_revenue` detects the payment SDK from `package.json`, connects the provider, and returns the webhook URL plus the exact events to enable.
3. Copy the provider signing secret from its webhook settings into Clarvivo at **Dashboard → Settings → Integrations**. Do not paste the secret into the agent or tool call.
4. Apply the returned client-to-server attribution edit. It reads `clv_vid` from browser local storage and puts it in the provider's supported metadata, custom data, or notes field. This is the step that makes revenue-by-channel work.
5. Complete a test payment, wait for delivery, then ask: **“Verify Clarvivo revenue.”**

The checkout snippet adapts to a Next.js route handler, Express handler, or serverless function. If no supported SDK is found, the tool returns a server-only signed `POST /api/ingest/:apiKey/revenue` example using `CLARVIVO_INGEST_SECRET`; that secret must never enter browser code.

## Track events & funnels

1. Ask: **“Track successful signups in Clarvivo.”** `add_event` registers the event and proposes a `window.clarvivo.trackEvent(...)` call for the success handler. The tool reports the edit; your coding agent applies it.
2. Ask: **“Create a Signup funnel with Landing, Pricing, and Success.”** `create_funnel` orders the steps, reuses an existing same-name funnel on retries, and points out steps that do not yet match a tracked page.
3. Ask: **“Alert me when conversion drops by 20%.”** `create_alert` reuses an existing alert of that type instead of creating duplicates.

The browser SDK global is `window.clarvivo`. It exposes `trackEvent(name, properties)`, `trackConversion(value, currency)`, and `trackPurchase(...)`.

## Configuration

Replace `clv_live_REPLACE_ME` below. Tokens are secrets; keep personal config files out of source control. The tracking API key returned by tools is intentionally public because it ships in page source.

For local development or self-hosting, add `CLARVIVO_BASE_URL` (for example `http://127.0.0.1:5000`) beside the token.

### Claude Code

The official CLI accepts `--env` before the `--` separator. This user-scoped command works from every project:

```bash
claude mcp add clarvivo --scope user \
  --env CLARVIVO_API_TOKEN=clv_live_REPLACE_ME \
  -- npx -y @clarvivo/mcp
```

Check it with `claude mcp get clarvivo`. See [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp).

### Cursor

Create `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "clarvivo": {
      "command": "npx",
      "args": ["-y", "@clarvivo/mcp"],
      "env": {
        "CLARVIVO_API_TOKEN": "clv_live_REPLACE_ME"
      }
    }
  }
}
```

One-click install with a placeholder token (review and replace it in Cursor before starting the server):

[Add Clarvivo to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=clarvivo&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjbGFydml2by9tY3AiXSwiZW52Ijp7IkNMQVJWSVZPX0FQSV9UT0tFTiI6ImNsdl9saXZlX1JFUExBQ0VfTUUifX0)

Cursor requires the single-server config to be JSON-stringified and base64-encoded in the `config` parameter. See [Cursor MCP configuration](https://cursor.com/docs/mcp) and [Cursor install links](https://cursor.com/docs/mcp/install-links).

### Codex CLI

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.clarvivo]
command = "npx"
args = ["-y", "@clarvivo/mcp"]

[mcp_servers.clarvivo.env]
CLARVIVO_API_TOKEN = "clv_live_REPLACE_ME"
```

The equivalent command is:

```bash
codex mcp add clarvivo \
  --env CLARVIVO_API_TOKEN=clv_live_REPLACE_ME \
  -- npx -y @clarvivo/mcp
```

This was checked against the installed `codex mcp add --help` and the [official OpenAI Codex MCP documentation](https://developers.openai.com/codex/mcp/).

### Windsurf

Open `~/.codeium/windsurf/mcp_config.json` and add:

```json
{
  "mcpServers": {
    "clarvivo": {
      "command": "npx",
      "args": ["-y", "@clarvivo/mcp"],
      "env": {
        "CLARVIVO_API_TOKEN": "clv_live_REPLACE_ME"
      }
    }
  }
}
```

Refresh the MCP list after saving. See [Windsurf’s MCP documentation](https://docs.windsurf.com/windsurf/cascade/mcp).

### Cline

Open Cline’s MCP Servers settings, choose **Configure MCP Servers**, and add this entry to `cline_mcp_settings.json` (normally under `~/.cline/data/settings/`):

```json
{
  "mcpServers": {
    "clarvivo": {
      "command": "npx",
      "args": ["-y", "@clarvivo/mcp"],
      "env": {
        "CLARVIVO_API_TOKEN": "clv_live_REPLACE_ME"
      },
      "disabled": false
    }
  }
}
```

See [Cline configuration locations](https://docs.cline.bot/getting-started/config).

### Visual Studio Code / GitHub Copilot

Create `.vscode/mcp.json`:

```json
{
  "servers": {
    "clarvivo": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@clarvivo/mcp"],
      "env": {
        "CLARVIVO_API_TOKEN": "clv_live_REPLACE_ME"
      }
    }
  }
}
```

One-click install with a placeholder token:

[Install Clarvivo in VS Code](vscode:mcp/install?%7B%22name%22%3A%22clarvivo%22%2C%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40clarvivo%2Fmcp%22%5D%2C%22env%22%3A%7B%22CLARVIVO_API_TOKEN%22%3A%22clv_live_REPLACE_ME%22%7D%7D)

VS Code’s URI uses URL-encoded JSON rather than Cursor’s base64 encoding. See the [VS Code MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp) and [configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

### Zed

Open your Zed settings file and merge:

```json
{
  "context_servers": {
    "clarvivo": {
      "command": "npx",
      "args": ["-y", "@clarvivo/mcp"],
      "env": {
        "CLARVIVO_API_TOKEN": "clv_live_REPLACE_ME"
      }
    }
  }
}
```

See [MCP in Zed](https://zed.dev/docs/ai/mcp).

### Generic MCP client

For clients using the common `mcpServers` shape:

```json
{
  "mcpServers": {
    "clarvivo": {
      "command": "npx",
      "args": ["-y", "@clarvivo/mcp"],
      "env": {
        "CLARVIVO_API_TOKEN": "clv_live_REPLACE_ME"
      }
    }
  }
}
```

Node.js 20 or newer is required.

## Authentication and billing errors

Every tool checks for `CLARVIVO_API_TOKEN` before doing work. If it is missing, the tool returns the token URL and a copy-pasteable environment variable name. The bearer token is never included in tool output or logs.

Tools also report a missing token scope by name and link directly to the API-token settings page. Payment signing secrets are dashboard-only: `connect_revenue` has no secret input and sends only `{ provider, connected: true }` to Clarvivo.

Clarvivo has no free tier. If project creation returns `PROJECT_LIMIT_REACHED`, HTTP 402, or HTTP 403, the tool stops immediately and links to [billing](https://app.clarvivo.com/dashboard/billing). It does not retry or claim the project was created.

## Development

```bash
cd mcp
npm install
npm run build
npm test
```

Set `CLARVIVO_BASE_URL=http://127.0.0.1:5000` when using a local Clarvivo server. Tests mock HTTP and never call production.

## Publishing checklist

No submission happens automatically. Complete these after the package and public repository are ready:

- [ ] **npm:** publish `clarvivo-mcp` publicly, confirm the `bin` is executable, and test a clean `npx -y @clarvivo/mcp` MCP initialize handshake. Use npm provenance/2FA and inspect `npm pack --dry-run` first.
- [ ] **Official MCP Registry:** verify the `io.github.cracked-collective/clarvivo` namespace, publish the matching npm version first, then run `mcp-publisher login`, `mcp-publisher validate`, and `mcp-publisher publish` against the included `server.json`. The registry stores metadata, not the package. Follow the [official registry quickstart](https://modelcontextprotocol.io/registry/quickstart).
- [ ] **Smithery:** authenticate with the Smithery CLI and publish a local MCP bundle (`.mcpb`) under the Clarvivo namespace, or publish a hosted URL if an HTTP transport is added later: `smithery mcp publish <bundle.mcpb> -n clarvivo/clarvivo`. Smithery’s current publisher accepts hosted URLs or MCP bundles; see [Smithery CLI publishing](https://www.npmjs.com/package/@smithery/cli).
- [ ] **mcp.so:** use the [server submission form](https://mcp.so/submit?type=server). It currently requires a public repository URL and name; the paid path is optional and advertises immediate publishing.
- [ ] **PulseMCP:** use the site’s **Submit** flow and provide the public repository, npm install command, fifteen-tool inventory, auth variable, license, and maintainer contact. Re-check the form at submission time because PulseMCP does not publish a stable submission schema.
- [ ] **Glama:** click **Add Server** in the [Glama registry](https://glama.ai/mcp/servers), submit the public GitHub repository, and add `glama.json` if organization ownership/metadata verification requests it. Confirm Glama can inspect all fifteen tools.
- [ ] **Cursor Marketplace:** package the MCP config as an Agent Plugin or Cursor Plugin with a valid `plugin.json` / `.cursor-plugin/plugin.json`, public Git repository, README, and optional committed logo; declare the token variable in the manifest schema, then submit the repository at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). Use the [official submission checklist](https://cursor.com/docs/reference/plugins).
- [ ] **awesome-mcp-servers:** first ensure the Glama listing exists, then fork [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers), add one alphabetized line in the appropriate category with repository link and concise description, and open a PR following its [contribution guide](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md).
- [ ] **Additional discovery:** submit the same canonical metadata to `mcpservers.org`, `MCP Central`, and `mcp-marketplace.io`; keep every listing pointed at the npm package and one canonical repository so versions and security notices do not drift.

For every listing, use the same name, description, repository, license, token variable, Node requirement, fifteen-tool inventory, and install snippets from this README.
