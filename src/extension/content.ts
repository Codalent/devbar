/// <reference types="chrome" />
/**
 * The toolbar, in the extension's isolated world: the page's CSP, Trusted Types and scripts don't
 * apply to it. The service worker injects this file and then calls `run`:
 *
 * `run("click")`, the icon was clicked:
 * - not on the page yet: show it with its pills unfolded (New task, Feedback session, Record);
 * - on the page, pills folded: unfold them;
 * - on the page, pills unfolded and nothing in progress: take it off the page;
 * - a form, a recording or a feedback session in progress: leave it (fold or unfold the pills).
 *
 * `run("resume")`, a page loaded in a tab a feedback session follows: show the toolbar, folded,
 * with the session's bar and pins.
 *
 * Save downloads the item: a `.md` file, or a `.zip` with the `.md` next to `assets/` when there is
 * a screenshot or a recording. A feedback session downloads the same way. There is no backend and
 * no board.
 */
import { NAME } from "../name.js";
import { addConsoleEntry, captureScreenshot, type ConsoleEntry } from "../client/context.js";
import { loadFonts } from "../client/fonts.js";
import { Toolbar } from "../client/widget.js";
import { downloadInfo, downloadSession } from "../session/finish.js";
import { SessionManager } from "../session/manager.js";
import type { Session, SessionStore } from "../session/model.js";
import { CAPTURE, CONSOLE_EVENT, SESSION_KEY, shotKey } from "./shared.js";

interface Handle {
  menu(on?: boolean): void;
  readonly menuOpen: boolean;
  readonly formOpen: boolean;
  readonly recordingState: string;
  newItem(type?: string): void;
  toast(text: string, code?: string, bad?: boolean): void;
}

type Mode = "click" | "resume";

const MAX_SIDE = 1600;
const KEY = "__devbarExtension";
const scope = globalThis as unknown as Record<string, { run(mode: Mode): void } | undefined>;

let toolbar: Toolbar | null = null;
let handle: Handle | null = null;

async function storedSession(): Promise<Session | null> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return (stored[SESSION_KEY] as Session | undefined) ?? null;
}

/** The session as the service worker keeps it: changes are messages, reads go to the storage. */
const store: SessionStore = {
  load: storedSession,
  apply: (message) => chrome.runtime.sendMessage(message),
  async screenshots(ids) {
    const stored = ids.length ? await chrome.storage.local.get(ids.map(shotKey)) : {};
    const out = new Map<string, string>();
    for (const id of ids) {
      const data = stored[shotKey(id)];
      if (typeof data === "string") out.set(id, data);
    }
    return out;
  },
  subscribe(fn) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && SESSION_KEY in changes) fn((changes[SESSION_KEY].newValue as Session | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
};

const sessions = new SessionManager({
  store,
  toolbar: () => (toolbar && handle ? { host: toolbar.host, toast: (text, code, bad) => handle?.toast(text, code, bad) } : null),
  capture: (hide) => captureTab(hide),
  finishInfo: downloadInfo,
  async finish(session, title, notes) {
    const name = await downloadSession(store, session, title, notes, toolbar?.host.shadowRoot ?? document.body);
    handle?.toast("Downloaded the session", name);
  },
  // A session started in another tab shows here only while devbar is open here.
  adopt: () => !!toolbar,
});

function showToolbar(unfold: boolean) {
  if (!toolbar) {
    toolbar = new Toolbar(null, undefined, {
      screenshot,
      layout: "flat",
      consoleSince: "since devbar opened",
      actions: [sessions.action()],
    });
    handle = toolbar.handle() as unknown as Handle;
    loadFonts(NAME);
    toolbar.mount();
  }
  // Let the dot land before the pills unfold from it.
  if (unfold) requestAnimationFrame(() => requestAnimationFrame(() => handle?.menu(true)));
}

function hideToolbar() {
  toolbar?.destroy();
  toolbar = null;
  handle = null;
}

async function run(mode: Mode) {
  if (!document.body) return;
  const current = await storedSession();
  if (mode === "resume") {
    if (!current) return;
    showToolbar(false);
    sessions.show(current);
    return;
  }
  if (current) {
    // Clicked in a tab the session wasn't following yet (or on another site): join it here.
    void store.apply({ type: "session:join" });
    const fresh = !toolbar;
    showToolbar(false);
    sessions.show(current);
    if (fresh) return handle?.menu(true);
  }
  if (!toolbar || !handle) return showToolbar(true);
  if (handle.formOpen) return handle.newItem(); // focuses the open form, keeps the draft
  if (!handle.menuOpen) return handle.menu(true);
  if (handle.recordingState !== "idle" || sessions.active) return handle.menu(false);
  hideToolbar();
}

/** The visible tab as Chrome draws it, with `hide` (devbar's layers) hidden, or null when Chrome refuses. */
async function captureTab(hide: HTMLElement[]): Promise<string | null> {
  // Opacity, not visibility: the toolbar's root sets its own visibility, which would win.
  for (const h of hide) h.style.setProperty("opacity", "0", "important");
  try {
    // Two frames, so the hidden layers are off the screen Chrome captures.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const reply: { dataUrl?: string; error?: string } | undefined = await chrome.runtime.sendMessage({ type: CAPTURE });
    return reply?.dataUrl ?? null;
  } catch {
    return null;
  } finally {
    for (const h of hide) h.style.setProperty("opacity", "1", "important");
  }
}

/** The form's screenshot: the tab, long side at most 1600 px; else the page drawn, as the script-tag toolbar does. */
async function screenshot(exclude: HTMLElement): Promise<{ dataUrl: string }> {
  const layers = [exclude, sessions.host].filter((h): h is HTMLElement => !!h);
  const dataUrl = await captureTab(layers);
  if (!dataUrl) return captureScreenshot(layers);
  return { dataUrl: await shrink(dataUrl) };
}

async function shrink(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const k = MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight);
  if (k >= 1) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * k);
  canvas.height = Math.round(img.naturalHeight * k);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** Entries from the page-world listener. The page could send its own; keep them plain and short. */
function onConsole(event: Event) {
  const detail = (event as CustomEvent).detail;
  if (typeof detail !== "string" || detail.length > 20_000) return;
  try {
    const e = JSON.parse(detail) as Partial<ConsoleEntry>;
    if ((e.level !== "error" && e.level !== "warn") || typeof e.message !== "string") return;
    // Kept for the form, and heard by the session (onConsoleEntry).
    addConsoleEntry({
      level: e.level,
      message: e.message.slice(0, 2000),
      source: typeof e.source === "string" ? e.source.slice(0, 200) : undefined,
      time: typeof e.time === "number" ? e.time : Date.now(),
    });
  } catch {
    // not ours
  }
}

if (!scope[KEY]) {
  scope[KEY] = { run: (mode) => void run(mode) };
  document.addEventListener(CONSOLE_EVENT, onConsole);
}
