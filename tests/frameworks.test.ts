import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectFramework,
  frameworkIds,
  getInstallInstructions,
  trackingSnippet,
} from "../src/frameworks.js";

const tempDirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clarvivo-mcp-test-"));
  tempDirs.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return root;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("detectFramework", () => {
  it.each([
    ["Next.js App Router", { "package.json": '{"dependencies":{"next":"16"}}', "app/layout.tsx": "" }, "next-app"],
    ["Next.js Pages Router", { "package.json": '{"dependencies":{"next":"16"}}', "pages/index.tsx": "" }, "next-pages"],
    ["SvelteKit", { "package.json": '{"dependencies":{"@sveltejs/kit":"2","vite":"7"}}' }, "sveltekit"],
    ["Astro", { "package.json": '{"dependencies":{"astro":"5","vite":"7"}}' }, "astro"],
    ["Nuxt", { "package.json": '{"dependencies":{"nuxt":"4"}}' }, "nuxt"],
    ["Docusaurus", { "package.json": '{"dependencies":{"@docusaurus/core":"3"}}' }, "docusaurus"],
    ["Gatsby", { "package.json": '{"dependencies":{"gatsby":"5"}}' }, "gatsby"],
    ["React Router v7", { "package.json": '{"dependencies":{"@react-router/dev":"7","vite":"7"}}' }, "remix"],
    ["Create React App", { "package.json": '{"dependencies":{"react-scripts":"5"}}' }, "create-react-app"],
    ["Vite", { "package.json": '{"devDependencies":{"vite":"7"}}' }, "vite"],
    ["static HTML", { "index.html": "<!doctype html>" }, "static-html"],
  ])("detects %s", (_label, files, expected) => {
    expect(detectFramework(fixture(files))?.framework).toBe(expected);
  });

  it("prefers App Router when a Next.js repo contains both router directories", () => {
    const root = fixture({
      "package.json": '{"dependencies":{"next":"16"}}',
      "app/layout.tsx": "",
      "pages/index.tsx": "",
    });
    expect(detectFramework(root)?.framework).toBe("next-app");
  });
});

describe("snippet generation", () => {
  it("generates instructions for every supported framework", () => {
    for (const framework of frameworkIds) {
      const result = getInstallInstructions(framework, "public-key", "https://self.example", fixture({}));
      expect(result.file).not.toBe("");
      expect(result.code).toContain("https://self.example/js/public-key/analytics.js");
      expect(result.spaRouteTracking).toContain("pushState");
    }
  });

  it("uses next/script with afterInteractive for both Next.js routers", () => {
    for (const framework of ["next-app", "next-pages"] as const) {
      const code = getInstallInstructions(framework, "key", undefined, fixture({})).code;
      expect(code).toContain('from "next/script"');
      expect(code).toContain('strategy="afterInteractive"');
    }
  });

  it("uses CLARVIVO_BASE_URL for the public tracker URL", () => {
    expect(trackingSnippet("abc", "http://127.0.0.1:5000/"))
      .toBe('<script defer src="http://127.0.0.1:5000/js/abc/analytics.js"></script>');
  });
});
