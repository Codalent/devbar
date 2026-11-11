/// <reference types="chrome" />
/**
 * The extension's feedback session, kept in chrome.storage.local so it survives page loads, the
 * service worker sleeping and the browser restarting. This file, in the service worker, is its only
 * writer: the pages send messages and read the storage, so several tabs can't overwrite each other.
 * Screenshots are kept under keys of their own, so a new comment doesn't rewrite every image.
 */
import { localTimestamp } from "../item.js";
import { reduceSession, type Session, type SessionMessage, type SessionReply } from "../session/model.js";
import { SESSION_KEY, shotKey } from "./shared.js";

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

/** The icon's badge counts the session's comments, in every tab; empty with no session. */
export async function showSessionBadge(session: Session | null): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: "#5aa2ff" });
  await chrome.action.setBadgeText({ text: session ? String(session.comments.length) : "" });
}

export function handleSessionMessage(message: SessionMessage, tabId: number): Promise<SessionReply> {
  return serial(async () => {
    const result = reduceSession(await loadSession(), message, { tabId, uuid: () => crypto.randomUUID(), now: () => localTimestamp() });
    if (!result.ok) return { ok: false, error: result.error };
    if (result.dropShots === "all") {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("shot:")));
    } else if (result.dropShots?.length) {
      await chrome.storage.local.remove(result.dropShots.map(shotKey));
    }
    if (result.session) {
      await chrome.storage.local.set({ [SESSION_KEY]: result.session, ...(result.putShot ? { [shotKey(result.putShot.id)]: result.putShot.dataUrl } : {}) });
    } else {
      await chrome.storage.local.remove(SESSION_KEY);
    }
    await showSessionBadge(result.session);
    return { ok: true, session: result.session, comment: result.comment };
  });
}

export function tabClosed(tabId: number): Promise<void> {
  return serial(async () => {
    const session = await loadSession();
    if (!session?.tabs.includes(tabId)) return;
    session.tabs = session.tabs.filter((t) => t !== tabId);
    await chrome.storage.local.set({ [SESSION_KEY]: session });
  });
}
