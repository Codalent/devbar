/**
 * Runs feedback sessions next to the toolbar: starts one from the menu, puts it back after a page
 * load, keeps console errors per page, and shows changes made in other tabs. The widget and the
 * browser extension each give it a store, a way to take screenshots and a way to finish.
 */
import { browserInfo, consoleEntries, onConsoleEntry } from "../client/context.js";
import type { ToolbarAction } from "../client/widget.js";
import type { FinishInfo } from "./finish.js";
import { pageUrl, type Session, type SessionStore } from "./model.js";
import { SessionUI } from "./ui.js";

export interface SessionManagerOptions {
  store: SessionStore;
  /** The toolbar's element and toast, when it is on the page. */
  toolbar(): { host: HTMLElement; toast(text: string, code?: string, bad?: boolean): void } | null;
  /** The visible page as a PNG data URL without `hide`, or null. */
  capture(hide: HTMLElement[]): Promise<string | null>;
  finishInfo(session: Session): FinishInfo;
  /** Downloads or saves the session; toasts the result. Throws when it didn't work. */
  finish(session: Session, title: string, notes: string): Promise<void>;
  /** Whether a session started in another tab should show up here. Defaults to yes. */
  adopt?(): boolean;
}

export const SESSION_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/></svg>`;

export class SessionManager {
  private ui: SessionUI | null = null;
  private readonly stops: Array<() => void> = [];

  constructor(private readonly o: SessionManagerOptions) {
    this.stops.push(
      o.store.subscribe((session) => {
        if (!session) return this.hide();
        if (this.ui) this.ui.update(session);
        else if (o.adopt?.() ?? true) this.show(session);
      }),
      onConsoleEntry((e) => this.ui?.noteConsole({ level: e.level, message: e.message, source: e.source })),
    );
  }

  /** The toolbar's pill: start a session, or pin a comment when one is running. */
  action(): ToolbarAction {
    return { id: "session", label: "Feedback session", icon: SESSION_ICON, key: "s", run: () => void this.start() };
  }

  get active(): boolean {
    return !!this.ui;
  }

  get host(): HTMLElement | null {
    return this.ui?.host ?? null;
  }

  /** A session is stored: show it on this page. True when there was one. */
  async resume(): Promise<boolean> {
    const session = await this.o.store.load().catch(() => null);
    if (!session) return false;
    this.show(session);
    this.keepConsole();
    return true;
  }

  async start(): Promise<void> {
    if (this.ui) return this.ui.arm();
    const browser = (await browserInfo()).browser;
    const reply = await this.o.store.apply({ type: "session:start", page: { url: pageUrl(), title: document.title }, browser }).catch((error: Error) => ({ ok: false, error: error.message, session: null }));
    const toast = this.o.toolbar()?.toast;
    if (!reply.ok || !reply.session) return toast?.(`Could not start the session: ${reply.error ?? "unknown error"}`, undefined, true);
    this.show(reply.session).arm();
    this.keepConsole();
    toast?.("Feedback session on. Pin comments on any page of the site; Finish saves them all.");
  }

  /** The errors this page logged before the session showed up on it. */
  private keepConsole() {
    for (const e of consoleEntries()) this.ui?.noteConsole({ level: e.level, message: e.message, source: e.source });
  }

  show(session: Session): SessionUI {
    if (this.ui) {
      this.ui.update(session);
      return this.ui;
    }
    this.ui = new SessionUI(session, this.o.store, {
      capture: (hide) => this.o.capture(hide),
      toolbarHost: () => this.o.toolbar()?.host ?? null,
      toast: (text, code, bad) => this.o.toolbar()?.toast(text, code, bad),
      finishInfo: (s) => this.o.finishInfo(s),
      finish: (s, title, notes) => this.o.finish(s, title, notes),
      ended: () => this.hide(),
    });
    this.ui.mount();
    return this.ui;
  }

  hide(): void {
    this.ui?.destroy();
    this.ui = null;
  }

  destroy(): void {
    this.hide();
    this.stops.forEach((fn) => fn());
  }
}
