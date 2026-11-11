/**
 * Feedback sessions: comments pinned across the pages of a site, saved together as one Markdown
 * file. This is the data and the one function that changes it, shared by the widget (which keeps a
 * session in localStorage and IndexedDB) and the browser extension (whose service worker keeps it in
 * chrome.storage). No DOM or Node APIs here, so the server can use it too.
 */
import type { PickedElement } from "../client/context.js";

export interface SessionConsoleEntry {
  level: "error" | "warn";
  message: string;
  source?: string;
}

export interface SessionPage {
  /** origin + path + query: the page's identity in a session. */
  url: string;
  title: string;
  console: SessionConsoleEntry[];
}

export interface SessionComment {
  id: string;
  /** Shown on the pin and drawn on the screenshot; kept when others are deleted. */
  n: number;
  url: string;
  pageTitle: string;
  text: string;
  created: string;
  /** The element under the pin, when there was one. */
  element: PickedElement | null;
  /** Where on that element the pin sits, as fractions of its box, so the pin follows it. */
  anchor: { selector: string; fx: number; fy: number } | null;
  /** The pin in document coordinates, for when the element can't be found again. */
  point: { x: number; y: number };
  viewport: string;
  hasScreenshot: boolean;
}

export interface Session {
  id: string;
  started: string;
  /** The extension's tabs the session follows (it comes back after a page load in them). */
  tabs: number[];
  nextN: number;
  pages: SessionPage[];
  comments: SessionComment[];
  browser?: string;
}

/** A change to the session. The extension sends these to its service worker; the widget applies them itself. */
export type SessionMessage =
  | { type: "session:start"; page: { url: string; title: string }; browser: string }
  | { type: "session:join" }
  | { type: "session:visit"; page: { url: string; title: string } }
  /** `n` is the number the page drew on the screenshot: the session's nextN when the pin dropped. */
  | { type: "session:comment"; comment: Omit<SessionComment, "id" | "hasScreenshot">; screenshot: string | null }
  | { type: "session:edit"; id: string; text: string }
  | { type: "session:delete"; id: string }
  | { type: "session:console"; url: string; entries: SessionConsoleEntry[] }
  | { type: "session:end" };

export interface SessionReply {
  ok: boolean;
  session?: Session | null;
  comment?: SessionComment;
  error?: string;
}

/** Where a session is kept. Every change goes through `apply`, so all hosts change it the same way. */
export interface SessionStore {
  load(): Promise<Session | null>;
  apply(message: SessionMessage): Promise<SessionReply>;
  /** Screenshots by comment id, as PNG data URLs. */
  screenshots(ids: string[]): Promise<Map<string, string>>;
  /** Changes made elsewhere (another tab). Returns a function that stops listening. */
  subscribe(fn: (session: Session | null) => void): () => void;
}

/** origin + path + query: hash changes and fragments stay on the same page. */
export const pageUrl = (loc: Location = location): string => loc.origin + loc.pathname + loc.search;

const MAX_CONSOLE_PER_PAGE = 30;
const MAX_TEXT = 20_000;

export interface ReduceContext {
  /** The extension's tab the message came from; the widget has none. */
  tabId?: number;
  uuid(): string;
  now(): string;
}

export interface ReduceResult extends SessionReply {
  session: Session | null;
  /** A screenshot to keep, under the new comment's id. */
  putShot?: { id: string; dataUrl: string };
  /** Screenshots to drop, by comment id; "all" when the session ended. */
  dropShots?: string[] | "all";
}

function cleanPage(page: { url?: unknown; title?: unknown } | undefined): { url: string; title: string } {
  return { url: String(page?.url ?? "").slice(0, 2000), title: String(page?.title ?? "").slice(0, 300) };
}

function visit(session: Session, page: { url: string; title: string }): SessionPage {
  let found = session.pages.find((p) => p.url === page.url);
  if (!found) {
    found = { url: page.url, title: page.title, console: [] };
    session.pages.push(found);
  } else if (page.title) found.title = page.title;
  return found;
}

function follow(session: Session, tabId: number | undefined) {
  if (tabId !== undefined && !session.tabs.includes(tabId)) session.tabs.push(tabId);
}

/** Applies one message to the session (a copy: the input is left alone). Checks what it's given. */
export function reduceSession(current: Session | null, message: SessionMessage, ctx: ReduceContext): ReduceResult {
  const session: Session | null = current ? (JSON.parse(JSON.stringify(current)) as Session) : null;
  if (message.type === "session:start") {
    // Already running (in another tab): join it rather than start over.
    const s: Session = session ?? { id: ctx.uuid(), started: ctx.now(), tabs: [], nextN: 1, pages: [], comments: [], browser: String(message.browser ?? "").slice(0, 200) };
    follow(s, ctx.tabId);
    visit(s, cleanPage(message.page));
    return { ok: true, session: s };
  }
  if (!session) return { ok: false, session: null, error: "no feedback session" };
  switch (message.type) {
    case "session:join":
      follow(session, ctx.tabId);
      return { ok: true, session };
    case "session:visit":
      follow(session, ctx.tabId);
      visit(session, cleanPage(message.page));
      return { ok: true, session };
    case "session:comment": {
      const c = message.comment;
      const page = visit(session, cleanPage({ url: c?.url, title: c?.pageTitle }));
      const n = Math.max(Number(c?.n) || 0, session.nextN);
      const shot = typeof message.screenshot === "string" && message.screenshot.startsWith("data:image/") ? message.screenshot : null;
      const comment: SessionComment = {
        id: ctx.uuid(),
        n,
        url: page.url,
        pageTitle: page.title,
        text: String(c?.text ?? "").slice(0, MAX_TEXT),
        created: ctx.now(),
        element: c?.element ?? null,
        anchor: c?.anchor ?? null,
        point: { x: Number(c?.point?.x) || 0, y: Number(c?.point?.y) || 0 },
        viewport: String(c?.viewport ?? "").slice(0, 40),
        hasScreenshot: !!shot,
      };
      session.comments.push(comment);
      session.nextN = n + 1;
      return { ok: true, session, comment, putShot: shot ? { id: comment.id, dataUrl: shot } : undefined };
    }
    case "session:edit": {
      const comment = session.comments.find((c) => c.id === message.id);
      if (!comment) return { ok: false, session, error: "no such comment" };
      comment.text = String(message.text ?? "").slice(0, MAX_TEXT);
      return { ok: true, session };
    }
    case "session:delete":
      session.comments = session.comments.filter((c) => c.id !== message.id);
      return { ok: true, session, dropShots: [message.id] };
    case "session:console": {
      const page = session.pages.find((p) => p.url === message.url);
      if (!page) return { ok: true, session };
      for (const e of (message.entries ?? []).slice(0, MAX_CONSOLE_PER_PAGE)) {
        const entry: SessionConsoleEntry = { level: e.level === "warn" ? "warn" : "error", message: String(e.message ?? "").slice(0, 2000), source: e.source ? String(e.source).slice(0, 200) : undefined };
        if (page.console.some((x) => x.level === entry.level && x.message === entry.message)) continue;
        if (page.console.length >= MAX_CONSOLE_PER_PAGE) break;
        page.console.push(entry);
      }
      return { ok: true, session };
    }
    case "session:end":
      return { ok: true, session: null, dropShots: "all" };
    default:
      return { ok: false, session, error: "unknown message" };
  }
}
