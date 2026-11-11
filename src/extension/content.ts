/// <reference types="chrome" />
/**
 * The toolbar, in the extension's isolated world: the page's CSP, Trusted Types and scripts don't
 * apply to it. The service worker injects this file each time the icon is clicked:
 *
 * - not on the page yet: show it with its pills unfolded (New task, Record);
 * - on the page, pills folded: unfold them;
 * - on the page, pills unfolded and nothing in progress: take it off the page;
 * - a form or a recording in progress: leave it, and bring the form back to focus.
 *
 * Save downloads the item: a `.md` file, or a `.zip` with the `.md` next to `assets/` when there is
 * a screenshot or a recording. There is no backend and no board.
 */
import { NAME } from "../name.js";
import { addConsoleEntry, captureScreenshot, type ConsoleEntry } from "../client/context.js";
import { loadFonts } from "../client/fonts.js";
import { Toolbar } from "../client/widget.js";
import { CAPTURE, CONSOLE_EVENT } from "./shared.js";

interface Handle {
  menu(on?: boolean): void;
  readonly menuOpen: boolean;
  readonly formOpen: boolean;
  readonly recordingState: string;
  newItem(type?: string): void;
}

const MAX_SIDE = 1600;
const KEY = "__devbarExtension";
const scope = globalThis as unknown as Record<string, { toggle(): void } | undefined>;

let toolbar: Toolbar | null = null;
let handle: Handle | null = null;

function show() {
  toolbar = new Toolbar(null, undefined, { screenshot, layout: "flat", consoleSince: "since devbar opened" });
  handle = toolbar.handle() as unknown as Handle;
  loadFonts(NAME);
  toolbar.mount();
  // Let the dot land before the pills unfold from it.
  requestAnimationFrame(() => requestAnimationFrame(() => handle?.menu(true)));
}

function toggle() {
  if (!document.body) return;
  if (!toolbar || !handle) return show();
  if (handle.formOpen) return handle.newItem(); // focuses the open form, keeps the draft
  if (handle.recordingState !== "idle") return handle.menu(true);
  if (!handle.menuOpen) return handle.menu(true);
  toolbar.destroy();
  toolbar = null;
  handle = null;
}

/** The tab as Chrome draws it, without the toolbar, long side at most 1600 px. */
async function screenshot(exclude: HTMLElement): Promise<{ dataUrl: string }> {
  // Opacity, not visibility: the toolbar's root sets its own visibility, which would win.
  exclude.style.setProperty("opacity", "0", "important");
  let reply: { dataUrl?: string; error?: string } | undefined;
  try {
    // Two frames, so the hidden toolbar is off the screen Chrome captures.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    reply = await chrome.runtime.sendMessage({ type: CAPTURE });
  } catch (error) {
    reply = { error: (error as Error).message };
  } finally {
    exclude.style.setProperty("opacity", "1", "important");
  }
  // Chrome can refuse (another window in front, the click's permission gone after navigating):
  // fall back to drawing the page, as the script-tag toolbar does.
  if (!reply?.dataUrl) return captureScreenshot(exclude);
  return { dataUrl: await shrink(reply.dataUrl) };
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

if (scope[KEY]) {
  scope[KEY]!.toggle();
} else {
  scope[KEY] = { toggle };
  document.addEventListener(CONSOLE_EVENT, onConsole);
  toggle();
}
