import { createServer, type ServerResponse } from "node:http";
import { NAME } from "../name.js";
import type { Config } from "./config.js";
import { createDevbar } from "./handler.js";

export { createDevbar, readVersion, type Devbar, type DevbarHandler, type DevbarOptions } from "./handler.js";
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

const ALLOWED_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

function refuse(res: ServerResponse, code: string, message: string) {
  res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error: { code, message } }));
}

/** The standalone server `npx devbar` starts: the handler on loopback, for pages on localhost. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
    throw new Error(`${NAME} only listens on loopback (127.0.0.1); refusing host ${host}.`);
  }
  const devbar = await createDevbar({ dir: options.dir, log: options.log, pages: true });
  const port = options.port ?? devbar.config.port;

  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    // A page on another machine name (DNS rebinding) or another site must not reach the files.
    if (!LOOPBACK_HOST.test(req.headers.host ?? "")) return refuse(res, "HOST_REFUSED", "Only loopback host names are served.");
    if (origin !== undefined && !ALLOWED_ORIGIN.test(origin)) {
      return refuse(res, "ORIGIN_REFUSED", "Only http://localhost, 127.0.0.1 and [::1] pages may call this server.");
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        ...(req.headers["access-control-request-private-network"] ? { "Access-Control-Allow-Private-Network": "true" } : {}),
      });
      return void res.end();
    }
    devbar.handle(req, res);
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
      return devbar.config;
    },
    async close() {
      await devbar.close();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closed;
    },
  };
}
