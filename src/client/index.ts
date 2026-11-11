import { GLOBAL_NAME, NAME } from "../name.js";
import { backendInfo, downloadInfo, downloadSession, SessionsUnsupported, uploadSession } from "../session/finish.js";
import { localSessionStore } from "../session/local-store.js";
import { SessionManager } from "../session/manager.js";
import type { Session } from "../session/model.js";
import { captureScreenshot, installConsoleBuffer } from "./context.js";
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
let sessions: SessionManager | null = null;

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
  const server = options.server?.trim().replace(/\/+$/, "") || null;
  const key = options.key || null;
  const start = () => {
    if (current) return;
    const store = localSessionStore();
    const toast = (text: string, code?: string, bad?: boolean) => (current?.handle() as { toast?: (t: string, c?: string, b?: boolean) => void } | undefined)?.toast?.(text, code, bad);
    const download = async (session: Session, title: string, notes: string) => {
      const name = await downloadSession(store, session, title, notes, current?.host.shadowRoot ?? document.body);
      toast("Downloaded the session", name);
    };
    const manager = new SessionManager({
      store,
      toolbar: () => (current ? { host: current.host, toast } : null),
      // The page drawn, leaving out devbar's own layers.
      capture: (hide) => captureScreenshot(hide).then((r) => r.dataUrl, () => null),
      finishInfo: (session) => (server ? backendInfo(server) : downloadInfo(session)),
      async finish(session, title, notes) {
        if (!server) return download(session, title, notes);
        try {
          const path = await uploadSession(server, key, store, session, title, notes);
          toast("Saved the session", path);
        } catch (error) {
          // An older backend: keep the work, as a download.
          if (!(error instanceof SessionsUnsupported)) throw error;
          await download(session, title, notes);
        }
      },
    });
    sessions = manager;
    current = new Toolbar(server, options.key, {
      actions: [manager.action()],
      // The form's screenshot leaves out the session's pins too.
      screenshot: (exclude) => captureScreenshot([exclude, manager.host].filter((h): h is HTMLElement => !!h)),
    });
    w[GLOBAL_NAME] = current.handle();
    loadFonts(NAME);
    current.mount();
    // A session from an earlier page of this site carries on here.
    void manager.resume();
  };
  w[GLOBAL_NAME] = { name: NAME, pending: true };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

export function unmount(): void {
  sessions?.destroy();
  sessions = null;
  current?.destroy();
  current = null;
  delete (window as unknown as Record<string, unknown>)[GLOBAL_NAME];
}
