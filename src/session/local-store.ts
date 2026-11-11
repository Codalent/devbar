/**
 * The widget's session store: the session in localStorage (small: text and positions), its
 * screenshots in IndexedDB (a few hundred kilobytes each). Both belong to the site's origin, so a
 * session carries on across page loads and routes, and other tabs of the site hear changes through
 * the `storage` event. Without IndexedDB (some private windows), screenshots last until the page
 * unloads.
 */
import { STORAGE_PREFIX } from "../name.js";
import { localTimestamp } from "../item.js";
import { reduceSession, type Session, type SessionStore } from "./model.js";

const KEY = `${STORAGE_PREFIX}session`;
const DB = `${STORAGE_PREFIX.replace(/:$/, "")}-sessions`;
const SHOTS = "screenshots";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function write(session: Session | null) {
  if (session) localStorage.setItem(KEY, JSON.stringify(session));
  else localStorage.removeItem(KEY);
}

let db: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, string>();

function open(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(SHOTS);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

async function shots<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await open();
  if (!d) return undefined;
  return new Promise((resolve, reject) => {
    const tx = d.transaction(SHOTS, mode);
    const req = work(tx.objectStore(SHOTS));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function localSessionStore(): SessionStore {
  return {
    load: async () => read(),
    async apply(message) {
      const result = reduceSession(read(), message, { uuid, now: () => localTimestamp() });
      if (!result.ok) return result;
      if (result.putShot) {
        const { id, dataUrl } = result.putShot;
        memory.set(id, dataUrl);
        await shots("readwrite", (s) => s.put(dataUrl, id)).catch(() => undefined);
      }
      if (result.dropShots === "all") {
        memory.clear();
        await shots("readwrite", (s) => s.clear()).catch(() => undefined);
      } else if (result.dropShots) {
        const ids = result.dropShots;
        for (const id of ids) memory.delete(id);
        await shots("readwrite", (s) => void ids.forEach((id) => s.delete(id))).catch(() => undefined);
      }
      write(result.session);
      return { ok: true, session: result.session, comment: result.comment };
    },
    async screenshots(ids) {
      const out = new Map<string, string>();
      for (const id of ids) {
        const data = memory.get(id) ?? (await shots<string>("readonly", (s) => s.get(id)).catch(() => undefined));
        if (typeof data === "string") out.set(id, data);
      }
      return out;
    },
    subscribe(fn) {
      const listener = (e: StorageEvent) => {
        if (e.key !== KEY && e.key !== null) return;
        fn(read());
      };
      window.addEventListener("storage", listener);
      return () => window.removeEventListener("storage", listener);
    },
  };
}
