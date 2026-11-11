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
 * a screenshot or a recording. There is no backend and no board.
 */
import { NAME } from "../name.js";
import { addConsoleEntry, browserInfo, captureScreenshot, type ConsoleEntry } from "../client/context.js";
import { loadFonts } from "../client/fonts.js";
import { Toolbar } from "../client/widget.js";
import { send, SessionUI } from "./session-ui.js";
import { CAPTURE, CONSOLE_EVENT, pageUrl, SESSION_KEY, type Session } from "./shared.js";

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
const ICON_PIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/></svg>`;
const scope = globalThis as unknown as Record<string, { run(mode: Mode): void } | undefined>;

let toolbar: Toolbar | null = null;
let handle: Handle | null = null;
let session: SessionUI | null = null;

function showToolbar(unfold: boolean) {
  if (!toolbar) {
    toolbar = new Toolbar(null, undefined, {
      screenshot,
      layout: "flat",
      consoleSince: "since devbar opened",
      actions: [{ id: "session", label: "Feedback session", icon: ICON_PIN, key: "s", run: () => void startSession() }],
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

async function storedSession(): Promise<Session | null> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return (stored[SESSION_KEY] as Session | undefined) ?? null;
}

function showSession(s: Session): SessionUI {
  if (session) {
    session.update(s);
    return session;
  }
  session = new SessionUI(s, {
    capture: captureTab,
    toolbarHost: () => toolbar?.host ?? null,
    toast: (text, code, bad) => handle?.toast(text, code, bad),
    ended: endSession,
  });
  session.mount();
  return session;
}

function endSession() {
  session?.destroy();
  session = null;
}

async function startSession() {
  if (session) return session.arm();
  const browser = (await browserInfo()).browser;
  const reply = await send({ type: "session:start", page: { url: pageUrl(), title: document.title }, browser });
  if (!reply.ok || !reply.session) return handle?.toast(`Could not start the session: ${reply.error ?? "unknown error"}`, undefined, true);
  showSession(reply.session).arm();
  handle?.toast("Feedback session on. Pin comments on any page of the site; Finish downloads them all.");
}

async function run(mode: Mode) {
  if (!document.body) return;
  const current = await storedSession();
  if (mode === "resume") {
    if (!current) return;
    showToolbar(false);
    showSession(current);
    return;
  }
  if (current) {
    // Clicked in a tab the session wasn't following yet (or on another site): join it here.
    void send({ type: "session:join" });
    const fresh = !toolbar;
    showToolbar(false);
    showSession(current);
    if (fresh) return handle?.menu(true);
  }
  if (!toolbar || !handle) return showToolbar(true);
  if (handle.formOpen) return handle.newItem(); // focuses the open form, keeps the draft
  if (!handle.menuOpen) return handle.menu(true);
  if (handle.recordingState !== "idle" || session) return handle.menu(false);
  hideToolbar();
}

/** The visible tab as Chrome draws it, with devbar hidden, or null when Chrome refuses. */
async function captureTab(): Promise<string | null> {
  const hosts = [toolbar?.host, session?.host].filter((h): h is HTMLElement => !!h);
  // Opacity, not visibility: the toolbar's root sets its own visibility, which would win.
  for (const h of hosts) h.style.setProperty("opacity", "0", "important");
  try {
    // Two frames, so the hidden layers are off the screen Chrome captures.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const reply: { dataUrl?: string; error?: string } | undefined = await chrome.runtime.sendMessage({ type: CAPTURE });
    return reply?.dataUrl ?? null;
  } catch {
    return null;
  } finally {
    for (const h of hosts) h.style.setProperty("opacity", "1", "important");
  }
}

/** The form's screenshot: the tab, long side at most 1600 px; else the page drawn, as the script-tag toolbar does. */
async function screenshot(exclude: HTMLElement): Promise<{ dataUrl: string }> {
  const dataUrl = await captureTab();
  if (!dataUrl) return captureScreenshot(exclude);
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
    const entry: ConsoleEntry = {
      level: e.level,
      message: e.message.slice(0, 2000),
      source: typeof e.source === "string" ? e.source.slice(0, 200) : undefined,
      time: typeof e.time === "number" ? e.time : Date.now(),
    };
    addConsoleEntry(entry);
    session?.noteConsole({ level: entry.level, message: entry.message, source: entry.source });
  } catch {
    // not ours
  }
}

/** Keep every tab in step: a comment added in one shows in the others; ending it anywhere ends it here. */
function onStorage(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area !== "local" || !(SESSION_KEY in changes)) return;
  const next = changes[SESSION_KEY].newValue as Session | undefined;
  if (!next) return endSession();
  if (session) session.update(next);
  else if (toolbar) showSession(next); // started in another tab while devbar is open here
}

if (!scope[KEY]) {
  scope[KEY] = { run: (mode) => void run(mode) };
  document.addEventListener(CONSOLE_EVENT, onConsole);
  chrome.storage.onChanged.addListener(onStorage);
}
