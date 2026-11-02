import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "chokidar";
import { DIR_NAME, NAME, STATUSES, type WidgetConfig } from "../name.js";
import { loadConfig, type Config } from "./config.js";
import { demoPage, landingPage } from "./pages.js";
import { createStore, StoreError } from "./store.js";

export { loadConfig, defaultConfig, type Config } from "./config.js";
export { createStore, slugify, type Item, type CreateInput } from "./store.js";

export interface ServerOptions {
  /** The data folder, `.devbar` in the project root. */
  dir: string;
  port?: number;
  /** Loopback only. Kept as an option for `::1`; anything that is not loopback is refused. */
  host?: string;
  log?: (line: string) => void;
}

export interface RunningServer {
  url: string;
  port: number;
  config: Config;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 25 * 1024 * 1024;
const ALLOWED_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

export async function readVersion(): Promise<string> {
  for (const candidate of [path.join(here, "..", "package.json"), path.join(here, "..", "..", "package.json")]) {
    try {
      const pkg = JSON.parse(await readFile(candidate, "utf8"));
      if (pkg.name && pkg.version) return String(pkg.version);
    } catch {
      // try the next
    }
  }
  return "0.0.0";
}

/** The widget bundle sits next to this file in dist/. */
async function widgetBundlePath(): Promise<string> {
  for (const candidate of [path.join(here, "devbar.js"), path.join(here, "..", "..", "dist", "devbar.js")]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // try the next
    }
  }
  throw new StoreError(500, "WIDGET_NOT_BUILT", "dist/devbar.js is missing; run the package's build.");
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const log = options.log ?? ((line: string) => console.log(line));
  const dataDir = path.resolve(options.dir);
  const loaded = await loadConfig(dataDir);
  let config = loaded.config;
  loaded.warnings.forEach((w) => log(`  ! ${w}`));
  const host = options.host ?? "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
    throw new Error(`${NAME} only listens on loopback (127.0.0.1); refusing host ${host}.`);
  }
  const port = options.port ?? config.port;
  const displayDir = path.relative(process.cwd(), dataDir).split(path.sep).join("/") || DIR_NAME;
  const store = createStore(dataDir, () => config, displayDir);
  await store.ensureFolders();
  const version = await readVersion();

  // ---- live updates: one SSE stream per open board, fed by a watcher on the data folder ----
  const clients = new Set<ServerResponse>();
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  const broadcast = (event: string, data: unknown) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  };
  const watcher = watch(dataDir, {
    ignoreInitial: true,
    depth: 2,
    ignored: (p: string) => /(^|[\\/])\.git([\\/]|$)|node_modules/.test(p),
  });
  watcher.on("all", (_event, changed) => {
    const rel = path.relative(dataDir, changed).split(path.sep).join("/");
    pending.add(rel);
    if (rel === "config.json") {
      loadConfig(dataDir).then((next) => {
        config = next.config;
        next.warnings.forEach((w) => log(`  ! ${w}`));
        broadcast("config", widgetConfig());
      });
    }
    if (timer) return;
    timer = setTimeout(() => {
      const files = [...pending];
      pending = new Set();
      timer = null;
      broadcast("change", { files });
    }, 120);
  });
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
  }, 25_000);

  function widgetConfig(): WidgetConfig {
    const { assets, ...folders } = config.folders;
    return {
      assets,
      project: config.project,
      dir: displayDir,
      position: config.position,
      shortcut: config.shortcut,
      toggles: config.toggles,
      folders,
    };
  }

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    const json = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(json);
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new StoreError(413, "TOO_LARGE", "The request body is too large.");
      chunks.push(chunk as Buffer);
    }
    if (!size) return {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return parsed;
    } catch {
      throw new StoreError(400, "BAD_JSON", "The body must be a JSON object.");
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    // A page on another machine name (DNS rebinding) or another site must not reach the files.
    if (!LOOPBACK_HOST.test(req.headers.host ?? "")) {
      return send(res, 403, { error: { code: "HOST_REFUSED", message: "Only loopback host names are served." } });
    }
    if (origin !== undefined && !ALLOWED_ORIGIN.test(origin)) {
      return send(res, 403, { error: { code: "ORIGIN_REFUSED", message: "Only http://localhost, 127.0.0.1 and [::1] pages may call this server." } });
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    const method = req.method ?? "GET";
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        ...(req.headers["access-control-request-private-network"] ? { "Access-Control-Allow-Private-Network": "true" } : {}),
      });
      return void res.end();
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        throw new StoreError(400, "BAD_PATH", "Malformed path.");
      }
    });
    const route = `${method} /${parts.map((p, i) => (parts[0] === "api" && parts[1] === "items" && i === 2 ? ":id" : parts[0] === "assets" && i === 1 ? ":name" : p)).join("/")}`;
    const serverUrl = `http://${req.headers.host}`;

    switch (route) {
      case "GET /":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return void res.end(landingPage({ serverUrl, project: config.project, dir: displayDir, version }));
      case "GET /demo":
      case "GET /demo/login":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return void res.end(demoPage({ page: parts[1] === "login" ? "login" : "agents", reset: url.searchParams.has("reset"), disabled: url.searchParams.has("disabled") }));
      case "GET /devbar.js.map": {
        const file = `${await widgetBundlePath()}.map`;
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
        createReadStream(file).on("error", () => res.end("{}")).pipe(res);
        return;
      }
      case "GET /devbar.js": {
        const file = await widgetBundlePath();
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
        createReadStream(file).pipe(res);
        return;
      }
      case "GET /api/health":
        return send(res, 200, { name: NAME, version, dir: dataDir, counts: await store.counts(), config: widgetConfig() });
      case "GET /api/items":
        return send(res, 200, { project: config.project, dir: displayDir, statuses: STATUSES, items: await store.list() });
      case "POST /api/items": {
        const item = await store.create((await readJson(req)) as never);
        log(`  + ${item.path}`);
        return send(res, 201, { item });
      }
      case "GET /api/items/:id":
        return send(res, 200, { item: await store.get(parts[2]) });
      case "PUT /api/items/:id": {
        const item = await store.update(parts[2], (await readJson(req)) as never);
        log(`  ~ ${item.path}`);
        return send(res, 200, { item });
      }
      case "POST /api/items/:id/move": {
        const body = await readJson(req);
        const item = await store.move(parts[2], String(body.status ?? ""));
        log(`  → ${item.path}`);
        return send(res, 200, { item });
      }
      case "DELETE /api/items/:id": {
        const item = await store.remove(parts[2]);
        log(`  - ${item.path}`);
        return send(res, 200, { deleted: item });
      }
      case "GET /api/events": {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`retry: 60000\nevent: hello\ndata: ${JSON.stringify({ version })}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      case "GET /assets/:name": {
        const file = await store.assetFile(parts[1]);
        const type = /\.png$/i.test(file) ? "image/png" : /\.jpe?g$/i.test(file) ? "image/jpeg" : /\.webp$/i.test(file) ? "image/webp" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
        createReadStream(file).pipe(res);
        return;
      }
      default:
        return send(res, 404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${url.pathname}.` } });
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return void res.end();
      if (error instanceof StoreError) return send(res, error.status, { error: { code: error.code, message: error.message } });
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return send(res, 409, { error: { code: "EXISTS", message: "That file already exists." } });
      log(`  ! ${(error as Error).stack ?? error}`);
      send(res, 500, { error: { code: "INTERNAL", message: (error as Error).message } });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
    port,
    get config() {
      return config;
    },
    async close() {
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
      await watcher.close();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closed;
    },
  };
}
