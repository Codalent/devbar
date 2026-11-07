import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "chokidar";
import { DIR_NAME, NAME, STATUSES, type WidgetConfig } from "../name.js";
import { loadConfig, type Config } from "./config.js";
import { demoPage, landingPage } from "./pages.js";
import { createStore, StoreError } from "./store.js";

export interface DevbarOptions {
  /** The data folder, `.devbar` in the project root. */
  dir: string;
  log?: (line: string) => void;
  /**
   * Also answer `/` (a page with the script tag) and `/demo`. On for the standalone server, off
   * by default when you mount the handler in your own app.
   */
  pages?: boolean;
  /**
   * A shared secret. When set, every request must carry it, in an `X-Devbar-Key` header or a `key`
   * query parameter (for the event stream and images, which cannot send headers); one without it
   * is treated as a path devbar does not know (`next()`, or 404), so devbar looks switched off.
   * Give the same key to the widget: `mount({ server, key })`.
   */
  key?: string;
}

/** A Node request handler; `next` (Express, Connect) is called for paths devbar does not know. */
export type DevbarHandler = (req: IncomingMessage, res: ServerResponse, next?: (error?: unknown) => void) => void;

export interface Devbar {
  /** Mount it where you like: `app.use("/devbar", devbar.handle)` in Express, or call it from any Node server. */
  handle: DevbarHandler;
  readonly config: Config;
  /** The data folder as shown to people, e.g. `.devbar`. */
  displayDir: string;
  version: string;
  /** Stops watching the folder and ends the open event streams. */
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSET_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};
const MAX_BODY = 25 * 1024 * 1024;

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

const digest = (value: string) => createHash("sha256").update(value).digest();

/** In dist/devbar.js; switched on in the copy this backend serves (the same length, so the source map still fits). */
const SERVED_OFF = "devbar:served-by-backend=0";
const SERVED_ON = "devbar:served-by-backend=1";
let widgetCache: { file: string; mtime: number; body: string } | null = null;

/**
 * The widget as this backend serves it: marked so a script tag that loads it from here talks to
 * this backend without a `data-server`. Read again when the file changes (`pnpm dev`).
 */
async function servedWidget(): Promise<string> {
  const file = await widgetBundlePath();
  const mtime = (await stat(file)).mtimeMs;
  if (widgetCache?.file !== file || widgetCache.mtime !== mtime) {
    const body = (await readFile(file, "utf8")).replace(SERVED_OFF, SERVED_ON);
    widgetCache = { file, mtime, body };
  }
  return widgetCache.body;
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

/**
 * devbar's API, files and widget as one request handler, for the standalone server or your own.
 *
 * It decides nothing about who may call it: the standalone server allows loopback only, and an app
 * that mounts it applies its own CORS and access rules first. It reads the request body itself, so
 * mount it before a JSON body parser, or exempt its path from one (an item with a screenshot is a
 * few megabytes); a body a parser already read is used as it is.
 */
export async function createDevbar(options: DevbarOptions): Promise<Devbar> {
  const log = options.log ?? ((line: string) => console.log(line));
  const dataDir = path.resolve(options.dir);
  const loaded = await loadConfig(dataDir);
  let config = loaded.config;
  loaded.warnings.forEach((w) => log(`  ! ${w}`));
  const relative = path.relative(process.cwd(), dataDir).split(path.sep).join("/");
  const displayDir = !relative ? DIR_NAME : relative.startsWith("..") ? path.basename(dataDir) : relative;
  const store = createStore(dataDir, () => config, displayDir);
  await store.ensureFolders();
  const version = await readVersion();
  if (options.key !== undefined && !options.key) throw new Error("devbar: `key` must not be empty.");
  const expectedKey = options.key ? digest(options.key) : null;
  /** Compares hashes, so the time taken says nothing about the key. */
  const keyMatches = (req: IncomingMessage, url: URL) => {
    if (!expectedKey) return true;
    const header = req.headers["x-devbar-key"];
    const given = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get("key");
    return !!given && timingSafeEqual(digest(given), expectedKey);
  };

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
  heartbeat.unref();

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

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const parsed = (req as IncomingMessage & { body?: unknown }).body;
    if (req.readableEnded && parsed && typeof parsed === "object" && !Array.isArray(parsed) && !Buffer.isBuffer(parsed)) {
      return parsed as Record<string, unknown>;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new StoreError(413, "TOO_LARGE", "The request body is too large.");
      chunks.push(chunk as Buffer);
    }
    if (!size) return {};
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
      return body;
    } catch {
      throw new StoreError(400, "BAD_JSON", "The body must be a JSON object.");
    }
  }

  /** Files a page on another origin loads with a plain tag; say so, whatever the host app's default. */
  const embeddable = { "Cross-Origin-Resource-Policy": "cross-origin" };

  async function route(req: IncomingMessage, res: ServerResponse, next?: (error?: unknown) => void): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://devbar.invalid");
    if (!keyMatches(req, url)) {
      if (next) return next();
      return send(res, 404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${url.pathname}.` } });
    }
    const parts = url.pathname.split("/").filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        throw new StoreError(400, "BAD_PATH", "Malformed path.");
      }
    });
    const route = `${method} /${parts.map((p, i) => (parts[0] === "api" && parts[1] === "items" && i === 2 ? ":id" : parts[0] === "assets" && i === 1 ? ":name" : p)).join("/")}`;

    switch (route) {
      case "GET /":
        if (!options.pages) break;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return void res.end(landingPage({ serverUrl: `http://${req.headers.host}`, project: config.project, dir: displayDir, version }));
      case "GET /demo":
      case "GET /demo/login":
        if (!options.pages) break;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return void res.end(demoPage({ page: parts[1] === "login" ? "login" : "agents", reset: url.searchParams.has("reset"), disabled: url.searchParams.has("disabled"), standalone: url.searchParams.has("standalone") }));
      case "GET /devbar.js.map": {
        const file = `${await widgetBundlePath()}.map`;
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", ...embeddable });
        createReadStream(file).on("error", () => res.end("{}")).pipe(res);
        return;
      }
      case "GET /devbar.js": {
        const body = await servedWidget();
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", ...embeddable });
        return void res.end(body);
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
      case "PUT /api/items/:id/recording": {
        const parsed = (req as IncomingMessage & { body?: unknown }).body;
        const body = req.readableEnded && Buffer.isBuffer(parsed) ? parsed : (req as AsyncIterable<Buffer>);
        const item = await store.writeRecording(parts[2], req.headers["content-type"], body);
        log(`  ▶ ${item.recording} for ${item.path}`);
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
        const type = ASSET_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
        const headers = { "Content-Type": type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", ...embeddable };
        // Ranges, so a video player can seek in a recording without loading all of it.
        const { size } = await stat(file);
        const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start >= size || start > end) {
            res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
            return void res.end();
          }
          res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) });
          createReadStream(file, { start, end }).pipe(res);
          return;
        }
        res.writeHead(200, { ...headers, "Content-Length": String(size) });
        createReadStream(file).pipe(res);
        return;
      }
    }
    if (next) return next();
    return send(res, 404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${url.pathname}.` } });
  }

  const handle: DevbarHandler = (req, res, next) => {
    route(req, res, next).catch((error: unknown) => {
      if (res.headersSent) return void res.end();
      if (error instanceof StoreError) return send(res, error.status, { error: { code: error.code, message: error.message } });
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return send(res, 409, { error: { code: "EXISTS", message: "That file already exists." } });
      log(`  ! ${(error as Error).stack ?? error}`);
      send(res, 500, { error: { code: "INTERNAL", message: (error as Error).message } });
    });
  };

  return {
    handle,
    get config() {
      return config;
    },
    displayDir,
    version,
    async close() {
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
      await watcher.close();
    },
  };
}
