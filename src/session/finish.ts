/**
 * Finishing a feedback session: download it (one Markdown file, in a zip with a screenshot per
 * comment), or send it to a backend's `POST /api/sessions`, which stores it as one item.
 */
import { dataUrlBytes, zip } from "../client/zip.js";
import { localTimestamp } from "../item.js";
import { buildSessionMarkdown, commentShotName, sessionFileBase } from "./markdown.js";
import type { Session, SessionStore } from "./model.js";

export interface FinishInfo {
  action: string;
  target: string;
  note: string;
}

export function downloadInfo(session: Session): FinishInfo {
  const zipped = session.comments.some((c) => c.hasScreenshot);
  return {
    action: "Download",
    target: `↓ ${sessionFileBase(session)}${zipped ? ".zip" : ".md"}`,
    note: `in one Markdown file${zipped ? " with a screenshot per comment (a zip)" : ""}. The session ends once it downloads.`,
  };
}

export function backendInfo(server: string): FinishInfo {
  let host = server;
  try {
    host = new URL(server, location.href).host;
  } catch {
    // keep it as given
  }
  return { action: "Save", target: `→ ${host}`, note: "saved as one item with a screenshot per comment. The session ends once it is saved." };
}

/** The whole session as a download. Returns the file's name. */
export async function downloadSession(store: SessionStore, session: Session, title: string, notes: string, parent: Node): Promise<string> {
  const base = sessionFileBase(session);
  const comments = [...session.comments].sort((a, b) => a.n - b.n);
  const stored = await store.screenshots(comments.filter((c) => c.hasScreenshot).map((c) => c.id));
  const screenshots = new Map<string, string>();
  const files: { name: string; data: Uint8Array }[] = [];
  for (const c of comments) {
    const data = stored.get(c.id);
    if (!data) continue;
    const name = commentShotName(base, c.n);
    screenshots.set(c.id, name);
    files.push({ name, data: dataUrlBytes(data) });
  }
  const md = new TextEncoder().encode(buildSessionMarkdown(session, { title, notes, finished: localTimestamp(), screenshots }));
  const name = files.length ? `${base}.zip` : `${base}.md`;
  const blob = files.length ? zip([{ name: `${base}.md`, data: md }, ...files]) : new Blob([md], { type: "text/markdown;charset=utf-8" });
  saveBlob(parent, name, blob);
  return name;
}

/** The backend has no `POST /api/sessions` (an older devbar, or one that only takes items). */
export class SessionsUnsupported extends Error {}

/** Sends the session to `<server>/api/sessions`. Returns the item's path as the backend names it. */
export async function uploadSession(server: string, key: string | null, store: SessionStore, session: Session, title: string, notes: string): Promise<string> {
  const stored = await store.screenshots(session.comments.filter((c) => c.hasScreenshot).map((c) => c.id));
  const body = JSON.stringify({ title, notes, session, finished: localTimestamp(), screenshots: Object.fromEntries(stored) });
  let res: Response;
  try {
    res = await fetch(`${server}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Devbar-Key": key } : {}) },
      body,
    });
  } catch {
    throw new Error(`could not reach ${server}`);
  }
  if (res.status === 404 || res.status === 405) throw new SessionsUnsupported("the backend has no /api/sessions");
  const data = (await res.json().catch(() => ({}))) as { item?: { path?: string; file?: string }; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `the backend answered ${res.status}`);
  return data.item?.path ?? data.item?.file ?? "the backend";
}

export function saveBlob(parent: Node, name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  parent.appendChild(a);
  a.click();
  a.remove();
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
