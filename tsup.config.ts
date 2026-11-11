import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf8"));
const define = { __VERSION__: JSON.stringify(version) };

export default defineConfig([
  // The CLI and the server: Node, ESM, dependencies left to node_modules.
  {
    entry: { cli: "src/cli.ts", server: "src/server/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    dts: { entry: { server: "src/server/index.ts" } },
    splitting: true,
    define,
  },
  // The script-tag bundle the server serves as /devbar.js: one self-contained file.
  {
    entry: { devbar: "src/client/auto.ts" },
    format: ["iife"],
    platform: "browser",
    target: "es2020",
    minify: true,
    noExternal: [/.*/],
    outExtension: () => ({ js: ".js" }),
    // ASCII only, so it runs whatever charset the host serving it sends (a CDN, a static folder).
    esbuildOptions(o) {
      o.charset = "ascii";
    },
    define: { ...define, "process.env.NODE_ENV": JSON.stringify("development") },
    // The widget wraps console.warn and console.error. Its source map puts the whole bundle on
    // Chrome's ignore list, so DevTools shows the page's own line for a warning, not devbar.js.
    sourcemap: true,
    async onSuccess() {
      const file = "dist/devbar.js.map";
      const map = JSON.parse(readFileSync(file, "utf8"));
      map.x_google_ignoreList = map.sources.map((_: string, i: number) => i);
      map.ignoreList = map.x_google_ignoreList;
      delete map.sourcesContent;
      writeFileSync(file, JSON.stringify(map));
    },
  },
  // devbar/client: the same widget as a module, for bundlers.
  {
    entry: { client: "src/client/index.ts" },
    format: ["esm"],
    platform: "browser",
    target: "es2020",
    dts: true,
    noExternal: ["html-to-image"],
    esbuildOptions(o) {
      o.charset = "ascii";
    },
    // esbuild fills in process.env.NODE_ENV for browser builds; leave it for the host's bundler,
    // which decides whether the toolbar is on.
    define: { ...define, "process.env.NODE_ENV": "process.env.NODE_ENV" },
  },
  // The Chrome extension, unpacked, in dist/extension: load it from chrome://extensions. Not
  // minified, so the Chrome Web Store's reviewers can read it.
  {
    entry: { background: "src/extension/background.ts", devbar: "src/extension/content.ts", console: "src/extension/console.ts" },
    outDir: "dist/extension",
    format: ["iife"],
    platform: "browser",
    target: "es2022",
    noExternal: [/.*/],
    outExtension: () => ({ js: ".js" }),
    esbuildOptions(o) {
      o.charset = "ascii";
    },
    define: { ...define, "process.env.NODE_ENV": JSON.stringify("development") },
    async onSuccess() {
      const manifest = JSON.parse(readFileSync("src/extension/manifest.json", "utf8"));
      manifest.version = version.replace(/-.*$/, ""); // Chrome takes only numbers and dots
      writeFileSync("dist/extension/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
      cpSync("src/extension/icons", "dist/extension/icons", { recursive: true });
    },
  },
  // devbar/react: a tiny component that imports devbar/client when it is on; React stays the host's.
  {
    entry: { react: "src/react.ts" },
    format: ["esm", "cjs"],
    platform: "neutral",
    target: "es2020",
    dts: true,
    external: ["react", "@codalent/devbar/client"],
    define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
  },
]);
