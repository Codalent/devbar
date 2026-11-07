import { GLOBAL_NAME, NAME } from "../name.js";
import { installConsoleBuffer } from "./context.js";
import { loadFonts } from "./fonts.js";
import { Toolbar } from "./widget.js";

export interface MountOptions {
  /**
   * Your devbar backend, e.g. `http://127.0.0.1:4711` (the local server) or
   * `https://api.example.com/devbar` (one you mounted or wrote). Leave it out and there is no
   * backend: Save downloads each item as a Markdown file (a zip when it has a screenshot), and
   * there is no board.
   */
  server?: string;
  /**
   * Show the toolbar. Defaults to true only when it can tell it is in development
   * (process.env.NODE_ENV === "development" as your bundler sets it); otherwise nothing renders.
   */
  enabled?: boolean;
  /** The backend's shared key, when it has one (`createDevbar({ key })`). Sent as `X-Devbar-Key`. */
  key?: string;
}

/** True only when a bundler says this is a development build. */
export function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV === "development";
  } catch {
    return false;
  }
}

let current: Toolbar | null = null;

/** Starts listening to the console now, so errors from before the toolbar mounts are kept. */
export function listen(ownScript: string | null = null): void {
  installConsoleBuffer(ownScript);
}

export function mount(options: MountOptions = {}): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const enabled = options.enabled ?? isDevelopment();
  if (!enabled) return; // nothing rendered, nothing requested
  const w = window as unknown as Record<string, unknown>;
  if (current || w[GLOBAL_NAME]) return; // loaded twice: keep the first
  installConsoleBuffer(null);
  const server = options.server?.trim() || null;
  const start = () => {
    if (current) return;
    current = new Toolbar(server, options.key);
    w[GLOBAL_NAME] = current.handle();
    loadFonts(NAME);
    current.mount();
  };
  w[GLOBAL_NAME] = { name: NAME, pending: true };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

export function unmount(): void {
  current?.destroy();
  current = null;
  delete (window as unknown as Record<string, unknown>)[GLOBAL_NAME];
}
