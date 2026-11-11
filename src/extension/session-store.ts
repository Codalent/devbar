/// <reference types="chrome" />
/**
 * The feedback session, kept in chrome.storage.local so it survives page loads, the service worker
 * sleeping and the browser restarting. This file, in the service worker, is its only writer: the
 * pages send messages and read the storage, so several tabs can't overwrite each other. Screenshots
 * are kept under keys of their own, so a new comment doesn't rewrite every image.
 */
import { localTimestamp } from "../item.js";
import { SESSION_KEY, shotKey, type Session, type SessionComment, type SessionConsoleEntry, type SessionMessage, type SessionPage } from "./shared.js";

const MAX_CONSOLE_PER_PAGE = 30;
const MAX_TEXT = 20_000;

let queue: Promise<unknown> = Promise.resolve();

/** Runs changes one after another, each on the stored state as the previous one left it. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

export async function loadSession(): Promise<Session | null> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return (stored[SESSION_KEY] as Session | undefined) ?? null;
}

async function store(session: Session, extra: Record<string, unknown> = {}): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: session, ...extra });
  await showSessionBadge(session);
}

/** The icon's badge counts the session's comments, in every tab; empty with no session. */
export async function showSessionBadge(session: Session | null): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: "#5aa2ff" });
  await chrome.action.setBadgeText({ text: session ? String(session.comments.length) : "" });
}

function cleanPage(page: { url?: unknown; title?: unknown }): { url: string; title: string } {
  return { url: String(page.url ?? "").slice(0, 2000), title: String(page.title ?? "").slice(0, 300) };
}

function visit(session: Session, page: { url: string; title: string }): SessionPage {
  let found = session.pages.find((p) => p.url === page.url);
  if (!found) {
    found = { url: page.url, title: page.title, console: [] };
    session.pages.push(found);
  } else if (page.title) found.title = page.title;
  return found;
}

function follow(session: Session, tabId: number) {
  if (!session.tabs.includes(tabId)) session.tabs.push(tabId);
}

export function handleSessionMessage(message: SessionMessage, tabId: number): Promise<Record<string, unknown>> {
  return serial(async () => {
    let session = await loadSession();
    if (message.type === "session:start") {
      // Already running (in another tab): join it rather than start over.
      if (!session) {
        session = { id: crypto.randomUUID(), started: localTimestamp(), tabs: [], nextN: 1, pages: [], comments: [], browser: String(message.browser ?? "").slice(0, 200) };
      }
      follow(session, tabId);
      visit(session, cleanPage(message.page));
      await store(session);
      return { ok: true, session };
    }
    if (!session) return { ok: false, error: "no feedback session" };
    switch (message.type) {
      case "session:join":
        follow(session, tabId);
        break;
      case "session:visit":
        follow(session, tabId);
        visit(session, cleanPage(message.page));
        break;
      case "session:comment": {
        const c = message.comment;
        const page = visit(session, cleanPage({ url: c.url, title: c.pageTitle }));
        const n = Math.max(Number(c.n) || 0, session.nextN);
        const screenshot = typeof message.screenshot === "string" && message.screenshot.startsWith("data:image/") ? message.screenshot : null;
        const comment: SessionComment = {
          id: crypto.randomUUID(),
          n,
          url: page.url,
          pageTitle: page.title,
          text: String(c.text ?? "").slice(0, MAX_TEXT),
          created: localTimestamp(),
          element: c.element ?? null,
          anchor: c.anchor ?? null,
          point: { x: Number(c.point?.x) || 0, y: Number(c.point?.y) || 0 },
          viewport: String(c.viewport ?? "").slice(0, 40),
          hasScreenshot: !!screenshot,
        };
        session.comments.push(comment);
        session.nextN = n + 1;
        await store(session, screenshot ? { [shotKey(comment.id)]: screenshot } : {});
        return { ok: true, session, comment };
      }
      case "session:edit": {
        const comment = session.comments.find((c) => c.id === message.id);
        if (!comment) return { ok: false, error: "no such comment" };
        comment.text = String(message.text ?? "").slice(0, MAX_TEXT);
        break;
      }
      case "session:delete":
        session.comments = session.comments.filter((c) => c.id !== message.id);
        await chrome.storage.local.remove(shotKey(message.id));
        break;
      case "session:console": {
        const page = session.pages.find((p) => p.url === message.url);
        if (!page) return { ok: true };
        for (const e of (message.entries ?? []).slice(0, MAX_CONSOLE_PER_PAGE)) {
          const entry: SessionConsoleEntry = { level: e.level === "warn" ? "warn" : "error", message: String(e.message ?? "").slice(0, 2000), source: e.source ? String(e.source).slice(0, 200) : undefined };
          if (page.console.some((x) => x.level === entry.level && x.message === entry.message)) continue;
          if (page.console.length >= MAX_CONSOLE_PER_PAGE) break;
          page.console.push(entry);
        }
        break;
      }
      case "session:end": {
        const all = await chrome.storage.local.get(null);
        await chrome.storage.local.remove([SESSION_KEY, ...Object.keys(all).filter((k) => k.startsWith("shot:"))]);
        await showSessionBadge(null);
        return { ok: true, session: null };
      }
      default:
        return { ok: false, error: "unknown message" };
    }
    await store(session);
    return { ok: true, session };
  });
}

export function tabClosed(tabId: number): Promise<void> {
  return serial(async () => {
    const session = await loadSession();
    if (!session?.tabs.includes(tabId)) return;
    session.tabs = session.tabs.filter((t) => t !== tabId);
    await store(session);
  });
}
