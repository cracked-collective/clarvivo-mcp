import fs from "node:fs";
import path from "node:path";

export const frameworkIds = [
  "next-app",
  "next-pages",
  "vite",
  "create-react-app",
  "astro",
  "sveltekit",
  "nuxt",
  "remix",
  "gatsby",
  "docusaurus",
  "static-html",
] as const;

export type FrameworkId = (typeof frameworkIds)[number];

export interface FrameworkDetection {
  framework: FrameworkId;
  confidence: "high" | "medium";
  evidence: string[];
}

export interface InstallInstructions {
  framework: FrameworkId;
  frameworkName: string;
  file: string;
  placement: string;
  code: string;
  snippet: string;
  spaRouteTracking: string;
}

const names: Record<FrameworkId, string> = {
  "next-app": "Next.js App Router",
  "next-pages": "Next.js Pages Router",
  vite: "Vite (React, Vue, or Svelte)",
  "create-react-app": "Create React App",
  astro: "Astro",
  sveltekit: "SvelteKit",
  nuxt: "Nuxt",
  remix: "Remix / React Router v7",
  gatsby: "Gatsby",
  docusaurus: "Docusaurus",
  "static-html": "Plain static HTML",
};

const aliases: Record<string, FrameworkId> = {
  "next-app": "next-app",
  "next.js-app-router": "next-app",
  "nextjs-app": "next-app",
  "next-app-router": "next-app",
  "next-pages": "next-pages",
  "next.js-pages-router": "next-pages",
  "nextjs-pages": "next-pages",
  "next-pages-router": "next-pages",
  vite: "vite",
  react: "vite",
  vue: "vite",
  "vite-react": "vite",
  "vite-vue": "vite",
  "vite-svelte": "vite",
  cra: "create-react-app",
  "create-react-app": "create-react-app",
  astro: "astro",
  sveltekit: "sveltekit",
  "svelte-kit": "sveltekit",
  nuxt: "nuxt",
  remix: "remix",
  "react-router": "remix",
  "react-router-v7": "remix",
  gatsby: "gatsby",
  docusaurus: "docusaurus",
  html: "static-html",
  static: "static-html",
  "static-html": "static-html",
};

/**
 * Every value normalizeFramework() accepts — canonical ids plus aliases.
 *
 * The tool schema advertises these as an enum rather than describing them in prose. A
 * bare `z.string()` let a client send the most natural guess ("nextjs"), which only
 * failed at runtime and cost a round trip; the schema now makes the wrong value
 * unrepresentable, and editors can autocomplete it. Deliberately derived from `aliases`
 * so a new framework cannot be added without appearing here.
 *
 * Note there is intentionally no bare "nextjs"/"next": Next.js App Router and Pages
 * Router need different files, so a single alias would have to guess, and guessing wrong
 * writes the snippet into a file that never renders.
 */
export const frameworkInputValues = Object.keys(aliases).sort() as [string, ...string[]];

export function normalizeFramework(value: string): FrameworkId {
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  const framework = aliases[normalized];
  if (!framework) {
    throw new Error(
      `Unsupported framework "${value}". Use one of: ${frameworkIds.join(", ")}.`,
    );
  }
  return framework;
}

function exists(root: string, relative: string): boolean {
  return fs.existsSync(path.join(root, relative));
}

function firstExisting(root: string, candidates: string[]): string | undefined {
  return candidates.find((candidate) => exists(root, candidate));
}

function readPackage(root: string): Record<string, string> {
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

function hasConfig(root: string, basename: string): boolean {
  return ["js", "mjs", "cjs", "ts", "mts", "cts"].some((ext) =>
    exists(root, `${basename}.${ext}`),
  );
}

export function detectFramework(root = process.cwd()): FrameworkDetection | undefined {
  const deps = readPackage(root);
  const evidence: string[] = [];

  if (deps.next || hasConfig(root, "next.config")) {
    if (deps.next) evidence.push("package.json includes next");
    if (hasConfig(root, "next.config")) evidence.push("next.config.* exists");
    const appMarker = firstExisting(root, [
      "app/layout.tsx", "app/layout.jsx", "app/layout.js", "app/layout.ts",
      "src/app/layout.tsx", "src/app/layout.jsx", "src/app/layout.js", "src/app/layout.ts",
    ]);
    if (appMarker) {
      return { framework: "next-app", confidence: "high", evidence: [...evidence, `${appMarker} exists`] };
    }
    const pagesMarker = firstExisting(root, [
      "pages/_app.tsx", "pages/_app.jsx", "pages/_app.js", "pages/index.tsx", "pages/index.jsx", "pages/index.js",
      "src/pages/_app.tsx", "src/pages/_app.jsx", "src/pages/_app.js", "src/pages/index.tsx", "src/pages/index.jsx", "src/pages/index.js",
    ]);
    return {
      framework: "next-pages",
      confidence: pagesMarker ? "high" : "medium",
      evidence: pagesMarker ? [...evidence, `${pagesMarker} exists`] : evidence,
    };
  }

  if (deps["@sveltejs/kit"] || (exists(root, "svelte.config.js") && exists(root, "src/app.html"))) {
    return {
      framework: "sveltekit",
      confidence: "high",
      evidence: deps["@sveltejs/kit"] ? ["package.json includes @sveltejs/kit"] : ["svelte.config.js and src/app.html exist"],
    };
  }
  if (deps.astro || hasConfig(root, "astro.config")) {
    return { framework: "astro", confidence: "high", evidence: [deps.astro ? "package.json includes astro" : "astro.config.* exists"] };
  }
  if (deps.nuxt || hasConfig(root, "nuxt.config")) {
    return { framework: "nuxt", confidence: "high", evidence: [deps.nuxt ? "package.json includes nuxt" : "nuxt.config.* exists"] };
  }
  if (deps["@docusaurus/core"] || hasConfig(root, "docusaurus.config")) {
    return { framework: "docusaurus", confidence: "high", evidence: [deps["@docusaurus/core"] ? "package.json includes @docusaurus/core" : "docusaurus.config.* exists"] };
  }
  if (deps.gatsby || hasConfig(root, "gatsby.config")) {
    return { framework: "gatsby", confidence: "high", evidence: [deps.gatsby ? "package.json includes gatsby" : "gatsby.config.* exists"] };
  }
  if (deps["@remix-run/react"] || deps["@react-router/dev"] || hasConfig(root, "react-router.config") || hasConfig(root, "remix.config")) {
    return {
      framework: "remix",
      confidence: "high",
      evidence: [deps["@remix-run/react"] ? "package.json includes @remix-run/react" : deps["@react-router/dev"] ? "package.json includes @react-router/dev" : "Remix/React Router config exists"],
    };
  }
  if (deps["react-scripts"]) {
    return { framework: "create-react-app", confidence: "high", evidence: ["package.json includes react-scripts"] };
  }
  if (deps.vite || hasConfig(root, "vite.config")) {
    return { framework: "vite", confidence: "high", evidence: [deps.vite ? "package.json includes vite" : "vite.config.* exists"] };
  }
  if (exists(root, "index.html")) {
    return { framework: "static-html", confidence: "medium", evidence: ["index.html exists and no supported framework marker was found"] };
  }
  return undefined;
}

function preferredFile(framework: FrameworkId, root: string): string {
  const choices: Record<FrameworkId, string[]> = {
    "next-app": ["app/layout.tsx", "src/app/layout.tsx", "app/layout.jsx", "src/app/layout.jsx", "app/layout.js", "src/app/layout.js"],
    "next-pages": ["pages/_app.tsx", "src/pages/_app.tsx", "pages/_app.jsx", "src/pages/_app.jsx", "pages/_app.js", "src/pages/_app.js"],
    vite: ["index.html"],
    "create-react-app": ["public/index.html"],
    astro: ["src/layouts/Layout.astro", "src/layouts/BaseLayout.astro", "src/pages/index.astro"],
    sveltekit: ["src/app.html"],
    nuxt: ["nuxt.config.ts", "nuxt.config.js"],
    remix: ["app/root.tsx", "app/root.jsx", "app/root.js"],
    gatsby: ["gatsby-ssr.tsx", "gatsby-ssr.jsx", "gatsby-ssr.js"],
    docusaurus: ["docusaurus.config.ts", "docusaurus.config.js"],
    "static-html": ["index.html"],
  };
  return firstExisting(root, choices[framework]) ?? choices[framework][0];
}

export function trackingSnippet(apiKey: string, baseUrl = "https://app.clarvivo.com"): string {
  return `<script defer src="${baseUrl.replace(/\/$/, "")}/js/${apiKey}/analytics.js"></script>`;
}

export function getInstallInstructions(
  framework: FrameworkId,
  apiKey: string,
  baseUrl = "https://app.clarvivo.com",
  root = process.cwd(),
): InstallInstructions {
  const src = `${baseUrl.replace(/\/$/, "")}/js/${apiKey}/analytics.js`;
  const snippet = trackingSnippet(apiKey, baseUrl);
  const file = preferredFile(framework, root);
  const common = {
    framework,
    frameworkName: names[framework],
    file,
    snippet,
    spaRouteTracking: "No router hook is needed: the Clarvivo tracker automatically observes pushState, replaceState, and popstate route changes.",
  };

  switch (framework) {
    case "next-app":
      return { ...common, placement: "Import Script, then render it inside the root layout's <body>.", code: `import Script from "next/script";\n\n// Inside <body>, after {children}:\n<Script src="${src}" strategy="afterInteractive" />` };
    case "next-pages":
      return { ...common, placement: "Import Script in the custom App and render it after <Component />. Create the file if it does not exist.", code: `import type { AppProps } from "next/app";\nimport Script from "next/script";\n\nexport default function App({ Component, pageProps }: AppProps) {\n  return (\n    <>\n      <Component {...pageProps} />\n      <Script src="${src}" strategy="afterInteractive" />\n    </>\n  );\n}` };
    case "vite":
      return { ...common, placement: "Add this immediately before </head> in the root index.html.", code: snippet };
    case "create-react-app":
      return { ...common, placement: "Add this immediately before </head> in public/index.html.", code: snippet };
    case "astro":
      return { ...common, placement: "Add this inside <head> in the shared layout used by every page.", code: snippet };
    case "sveltekit":
      return { ...common, placement: "Add this inside <head>, directly after %sveltekit.head%.", code: `%sveltekit.head%\n    ${snippet}` };
    case "nuxt":
      return { ...common, placement: "Merge this app.head entry into defineNuxtConfig (preserve existing config keys).", code: `export default defineNuxtConfig({\n  app: {\n    head: {\n      script: [{ src: "${src}", defer: true }],\n    },\n  },\n});` };
    case "remix":
      return { ...common, placement: "Add this script inside <head> in the root document returned by app/root.tsx.", code: snippet };
    case "gatsby":
      return { ...common, placement: "Add this SSR hook (merge it with an existing onRenderBody export if present).", code: `import React from "react";\n\nexport const onRenderBody = ({ setHeadComponents }) => {\n  setHeadComponents([\n    <script key="clarvivo" defer src="${src}" />,\n  ]);\n};` };
    case "docusaurus":
      return { ...common, placement: "Merge this scripts entry into the exported Docusaurus config.", code: `scripts: [\n  { src: "${src}", defer: true },\n],` };
    case "static-html":
      return { ...common, placement: "Add this immediately before </head> on every page (or in the shared HTML template).", code: snippet };
  }
}
