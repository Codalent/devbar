/** Names and shapes the extension's scripts share. */
import type { PickedElement } from "../client/context.js";

/** The toolbar asks the service worker for a screenshot of the tab. */
export const CAPTURE = "devbar:capture";

/** The page-world listener hands a console entry to the toolbar (detail: the entry as JSON). */
export const CONSOLE_EVENT = "devbar:console";

// ---------------------------------------------------------------------------------------------
// Feedback sessions: comments pinned across pages, saved together as one Markdown file.
// ---------------------------------------------------------------------------------------------

/** chrome.storage.local keys. Only the service worker writes them; the pages read and listen. */
export const SESSION_KEY = "session";
export const shotKey = (commentId: string): string => `shot:${commentId}`;

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
  /** Tabs the session follows: it comes back by itself after a page load in them. */
  tabs: number[];
  nextN: number;
  pages: SessionPage[];
  comments: SessionComment[];
  browser?: string;
}

/** Messages from a page to the service worker. Each answers `{ ok, session?, comment?, error? }`. */
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

/** origin + path + query: hash changes and fragments stay on the same page. */
export const pageUrl = (loc: Location = location): string => loc.origin + loc.pathname + loc.search;
