import { readFileSync, writeFileSync } from "node:fs";
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
    // esbuild fills in process.env.NODE_ENV for browser builds; leave it for the host's bundler,
    // which decides whether the toolbar is on.
    define: { ...define, "process.env.NODE_ENV": "process.env.NODE_ENV" },
  },
  // devbar/react: a tiny loader component; React stays the host's.
  {
    entry: { react: "src/react.ts" },
    format: ["esm", "cjs"],
    platform: "neutral",
    target: "es2020",
    dts: true,
    external: ["react"],
    define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
  },
]);
