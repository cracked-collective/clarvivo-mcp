import fs from "node:fs";
import path from "node:path";
import { detectFramework } from "./frameworks.js";

export const revenueProviders = ["stripe", "polar", "razorpay", "paddle", "lemonsqueezy", "dodo"] as const;
export type RevenueProvider = (typeof revenueProviders)[number];

const packages: Array<[string, RevenueProvider]> = [
  ["stripe", "stripe"],
  ["@polar-sh/sdk", "polar"],
  ["razorpay", "razorpay"],
  ["@paddle/paddle-node-sdk", "paddle"],
  ["@lemonsqueezy/lemonsqueezy.js", "lemonsqueezy"],
  ["dodopayments", "dodo"],
];

const aliases: Record<string, RevenueProvider | "custom"> = {
  stripe: "stripe",
  polar: "polar",
  "polar.sh": "polar",
  razorpay: "razorpay",
  paddle: "paddle",
  lemonsqueezy: "lemonsqueezy",
  "lemon-squeezy": "lemonsqueezy",
  dodo: "dodo",
  dodopayments: "dodo",
  custom: "custom",
};

function dependencies(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

export function normalizeProvider(value: string): RevenueProvider | "custom" {
  const provider = aliases[value.trim().toLowerCase()];
  if (!provider) throw new Error(`Unsupported payment provider "${value}". Use ${revenueProviders.join(", ")}, or custom.`);
  return provider;
}

export function detectRevenueProvider(root = process.cwd()): { provider: RevenueProvider; packageName: string } | undefined {
  const deps = dependencies(root);
  const match = packages.find(([packageName]) => Boolean(deps[packageName]));
  return match ? { packageName: match[0], provider: match[1] } : undefined;
}

export type ServerFramework = "next-route-handler" | "next-api-route" | "express" | "serverless" | "generic";

export function detectServerFramework(root = process.cwd()): ServerFramework {
  const framework = detectFramework(root);
  if (framework?.framework === "next-app") return "next-route-handler";
  if (framework?.framework === "next-pages") return "next-api-route";
  const deps = dependencies(root);
  if (deps.express) return "express";
  if (deps.serverless || deps["@netlify/functions"] || deps["@vercel/node"] || fs.existsSync(path.join(root, "serverless.yml"))) return "serverless";
  return "generic";
}

const providerDetails: Record<RevenueProvider, { events: string[]; dashboard: string }> = {
  stripe: {
    events: ["checkout.session.completed", "payment_intent.succeeded", "charge.refunded"],
    dashboard: "Stripe Dashboard → Workbench → Webhooks → open this endpoint → Reveal secret",
  },
  lemonsqueezy: {
    events: ["order_created", "order_refunded", "subscription_payment_success"],
    dashboard: "Lemon Squeezy Dashboard → Settings → Webhooks → create/open this webhook → Signing secret",
  },
  polar: {
    events: ["order.created", "subscription.created", "subscription.updated", "order.refunded"],
    dashboard: "Polar Dashboard → organization Settings → Developers → Webhooks → create/open the endpoint → Secret",
  },
  paddle: {
    events: ["transaction.completed", "adjustment.created", "adjustment.updated"],
    dashboard: "Paddle Dashboard → Developer tools → Notifications → create/open the notification destination → Secret key",
  },
  razorpay: {
    events: ["payment.captured", "refund.created"],
    dashboard: "Razorpay Dashboard → Account & Settings → Webhooks → create/open the webhook → Secret",
  },
  dodo: {
    events: ["payment.succeeded", "refund.succeeded"],
    dashboard: "Dodo Payments Dashboard → Developer → Webhooks → create/open the endpoint → Signing secret",
  },
};

function checkoutEdit(provider: RevenueProvider): string {
  const fields = "utm_source, utm_medium, utm_campaign";
  switch (provider) {
    case "stripe":
      return `const session = await stripe.checkout.sessions.create({\n  ...checkoutOptions,\n  client_reference_id: clvVid,\n  metadata: { ${fields} },\n});`;
    case "polar":
      return `const checkout = await polar.checkouts.create({\n  ...checkoutOptions,\n  metadata: { clv_visitor_id: clvVid, ${fields} },\n});`;
    case "razorpay":
      return `const order = await razorpay.orders.create({\n  ...orderOptions,\n  notes: { clv_visitor_id: clvVid, ${fields} },\n});`;
    case "paddle":
      return `const transaction = await paddle.transactions.create({\n  ...transactionOptions,\n  customData: { clv_visitor_id: clvVid, ${fields} }, // Paddle custom_data\n});`;
    case "lemonsqueezy":
      return `const checkout = await createCheckout(storeId, variantId, {\n  ...checkoutOptions,\n  checkoutData: { custom: { clv_visitor_id: clvVid, ${fields} } }, // checkout_data.custom\n});`;
    case "dodo":
      return `const payment = await client.payments.create({\n  ...paymentOptions,\n  metadata: { clv_visitor_id: clvVid, ${fields} },\n});`;
  }
}

function serverEdit(provider: RevenueProvider, framework: ServerFramework): string {
  const prelude = framework === "next-route-handler"
    ? `// In app/api/checkout/route.ts\nexport async function POST(request: Request) {\n  const { clvVid, utm_source, utm_medium, utm_campaign } = await request.json();`
    : framework === "next-api-route"
      ? `// In pages/api/checkout.ts\nexport default async function handler(req, res) {\n  const { clvVid, utm_source, utm_medium, utm_campaign } = req.body;`
    : framework === "express"
      ? `// In the Express checkout POST handler\napp.post("/api/checkout", async (req, res) => {\n  const { clvVid, utm_source, utm_medium, utm_campaign } = req.body;`
      : framework === "serverless"
        ? `// In the checkout serverless function\nexport async function handler(event) {\n  const { clvVid, utm_source, utm_medium, utm_campaign } = JSON.parse(event.body || "{}");`
        : `// In the server-side checkout handler\nconst { clvVid, utm_source, utm_medium, utm_campaign } = checkoutRequestBody;`;
  const ending = framework === "next-route-handler" ? "\n  // Keep your existing checkout response here.\n}"
    : framework === "next-api-route" ? "\n  // Keep your existing checkout response here.\n}"
    : framework === "express" ? "\n  // Keep your existing checkout response here.\n});"
      : framework === "serverless" ? "\n  // Keep your existing checkout response here.\n}"
        : "";
  return `${prelude}\n\n  ${checkoutEdit(provider).replace(/\n/g, "\n  ")}${ending}`;
}

const browserAttribution = `// In the browser, immediately before calling your checkout endpoint\nconst params = new URLSearchParams(window.location.search);\nconst attribution = {\n  clvVid: localStorage.getItem("clv_vid") || undefined,\n  utm_source: params.get("utm_source") || undefined,\n  utm_medium: params.get("utm_medium") || undefined,\n  utm_campaign: params.get("utm_campaign") || undefined,\n};\nawait fetch("/api/checkout", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(attribution),\n});`;

export function revenueChecklist(provider: RevenueProvider, webhookUrl: string, root = process.cwd()): string[] {
  const details = providerDetails[provider];
  const framework = detectServerFramework(root);
  return [
    `Paste this webhook URL into ${provider}: ${webhookUrl}\nEnable: ${details.events.join(", ")}.`,
    `${details.dashboard}. Paste that signing secret into Clarvivo at /dashboard/settings → Integrations — do not paste it here.`,
    `Make this attribution edit. It is what makes revenue-by-channel work.\n\n${browserAttribution}\n\n${serverEdit(provider, framework)}`,
  ];
}

export function signedRevenueSnippet(apiKey: string, baseUrl: string): string {
  return `// Server-side only. Keep CLARVIVO_INGEST_SECRET out of source control and browsers.\nimport crypto from "node:crypto";\n\nconst payload = JSON.stringify({\n  amount: 49.00, currency: "USD", event_type: "payment_success",\n  external_id: payment.id, visitor_id: clvVid,\n  utm_source, utm_medium, utm_campaign,\n});\nconst timestamp = Math.floor(Date.now() / 1000).toString();\nconst digest = crypto.createHmac("sha256", process.env.CLARVIVO_INGEST_SECRET!)\n  .update(\`\${timestamp}.revenue.\${payload}\`, "utf8").digest("hex");\nawait fetch("${baseUrl.replace(/\/$/, "")}/api/ingest/${apiKey}/revenue", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "X-Clarvivo-Signature": \`t=\${timestamp},v1=\${digest}\`,\n  },\n  body: payload,\n});`;
}
