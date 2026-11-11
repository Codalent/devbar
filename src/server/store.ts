import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import matter from "gray-matter";
import { PRIORITIES, STATUSES, TYPES, type ItemType, type Priority, type Status } from "../name.js";
import type { Config } from "./config.js";
import { buildMarkdown, localTimestamp, oneLine, slugify, yamlScalar, type CreateInput } from "../item.js";
import { buildSessionMarkdown } from "../session/markdown.js";
import type { Session, SessionComment } from "../session/model.js";

export { formatDuration, localTimestamp, slugify, yamlScalar, type CreateInput } from "../item.js";

export class StoreError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Item {
  /** Three-digit id from the file name, or null for a hand-made file with no number. */
  id: string | null;
  /** What the API addresses the item by: the id, or the file name without `.md`. */
  key: string;
  file: string;
  status: Status;
  /** Path for people: `.devbar/open/001-login-button.md`. */
  path: string;
  title: string;
  type: ItemType;
  priority: Priority;
  created: string | null;
  updated: string | null;
  page: string | null;
  /** Relative to the data folder, as the front matter has it: `assets/001-screenshot.png`. */
  screenshot: string | null;
  /** A screen recording, the same way: `assets/001-recording.webm`. */
  recording: string | null;
  hasFrontMatter: boolean;
  frontMatter: Record<string, unknown>;
}

export interface ItemWithBody extends Item {
  markdown: string;
  body: string;
}

export interface UpdateInput {
  markdown?: string;
  title?: string;
  type?: string;
  priority?: string;
}

const MD = /\.md$/i;
const ID_PREFIX = /^(\d+)(?:-|\.md$)/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const MAX_SESSION_COMMENTS = 500;

/** What `POST /api/sessions` takes: a feedback session from the widget, and its screenshots. */
export interface SessionInput {
  title?: string;
  notes?: string;
  finished?: string;
  session?: Partial<Session>;
  /** PNG data URLs by comment id. */
  screenshots?: Record<string, string>;
}

/** The session as sent, with every field the Markdown uses checked and given a type. */
function cleanSession(raw: Partial<Session> | undefined): Session {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.comments)) {
    throw new StoreError(400, "BAD_SESSION", "session.comments must be a list.");
  }
  if (raw.comments.length > MAX_SESSION_COMMENTS) throw new StoreError(413, "TOO_MANY_COMMENTS", `A session can have at most ${MAX_SESSION_COMMENTS} comments.`);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const comments: SessionComment[] = raw.comments.map((c, i) => {
    const el = c && typeof c.element === "object" && c.element ? c.element : null;
    return {
      id: str(c?.id, 100) || String(i),
      n: Math.max(1, Math.round(num(c?.n)) || i + 1),
      url: str(c?.url, 2000),
      pageTitle: str(c?.pageTitle, 300),
      text: str(c?.text, 20_000),
      created: str(c?.created, 40),
      element: el ? { tag: str(el.tag, 40), id: str(el.id, 200) || undefined, classes: [], text: str(el.text, 200) || undefined, selector: str(el.selector, 500), html: str(el.html, 500), rect: { x: 0, y: 0, w: 0, h: 0 } } : null,
      anchor: null,
      point: { x: num(c?.point?.x), y: num(c?.point?.y) },
      viewport: str(c?.viewport, 40),
      hasScreenshot: !!c?.hasScreenshot,
    };
  });
  const pages = (Array.isArray(raw.pages) ? raw.pages : []).slice(0, 1000).map((p) => ({
    url: str(p?.url, 2000),
    title: str(p?.title, 300),
    console: (Array.isArray(p?.console) ? p.console : []).slice(0, 30).map((e) => ({ level: e?.level === "warn" ? ("warn" as const) : ("error" as const), message: str(e?.message, 2000), source: str(e?.source, 200) || undefined })),
  }));
  return { id: str(raw.id, 100), started: str(raw.started, 40) || localTimestamp(), tabs: [], nextN: 0, pages, comments, browser: str(raw.browser, 200) || undefined };
}
const MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;
/** The video types a browser's MediaRecorder writes, and the extension each is stored with. */
const RECORDING_TYPES: Record<string, "webm" | "mp4"> = { "video/webm": "webm", "video/mp4": "mp4" };

export function recordingExtension(mimeType: unknown): "webm" | "mp4" | null {
  const base = String(mimeType ?? "").split(";")[0].trim().toLowerCase();
  return RECORDING_TYPES[base] ?? null;
}


/** Keeps `candidate` inside `base`, or throws: nothing outside the data folder is ever touched. */
export function inside(base: string, ...segments: string[]): string {
  const resolved = path.resolve(base, ...segments);
  const root = path.resolve(base);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new StoreError(400, "PATH_OUTSIDE_FOLDER", "That path is outside the data folder.");
  }
  return resolved;
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const s = String(value).trim();
  return s ? s : null;
}

/** The lines of a raw front-matter block, to edit one field without rewriting the others. */
function splitFrontMatter(raw: string): { lines: string[] | null; body: string } {
  const m = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { lines: null, body: raw };
  return { lines: m[1].split(/\r?\n/), body: raw.slice(m[0].length) };
}

export function createStore(dataDir: string, getConfig: () => Config, displayDir: string) {
  const root = path.resolve(dataDir);
  let chain: Promise<unknown> = Promise.resolve();

  /** Every write goes through here, one at a time: two saves at once cannot take the same id. */
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.catch(() => undefined);
    return run;
  }

  const folderOf = (status: Status) => inside(root, getConfig().folders[status]);
  const assetsDir = () => inside(root, getConfig().folders.assets);

  async function ensureFolders(): Promise<void> {
    for (const status of STATUSES) await mkdir(folderOf(status), { recursive: true });
    await mkdir(assetsDir(), { recursive: true });
  }

  async function filesIn(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir)).filter((name) => !name.startsWith("."));
    } catch {
      return [];
    }
  }

  function parse(raw: string, file: string, status: Status): ItemWithBody {
    const stem = file.replace(MD, "");
    const idMatch = file.match(ID_PREFIX);
    const id = idMatch ? idMatch[1] : null;
    let data: Record<string, unknown> = {};
    let body = raw;
    let hasFrontMatter = false;
    try {
      const parsed = matter(raw, {});
      data = (parsed.data ?? {}) as Record<string, unknown>;
      body = parsed.content;
      hasFrontMatter = Object.keys(data).length > 0;
    } catch {
      // Front matter a person broke by hand: show the file anyway, with what the name says.
    }
    const fallbackTitle = stem.replace(/^\d+-/, "").replace(/[-_]+/g, " ").trim() || stem;
    const type = TYPES.includes(data.type as ItemType) ? (data.type as ItemType) : "task";
    const priority = PRIORITIES.includes(data.priority as Priority) ? (data.priority as Priority) : "normal";
    const folder = getConfig().folders[status];
    return {
      id,
      key: id ?? stem,
      file,
      status,
      path: `${displayDir}/${folder}/${file}`,
      title: asString(data.title) ?? fallbackTitle,
      type,
      priority,
      created: asString(data.created),
      updated: asString(data.updated),
      page: asString(data.page),
      screenshot: asString(data.screenshot),
      recording: asString(data.recording),
      hasFrontMatter,
      frontMatter: jsonSafe(data) as Record<string, unknown>,
      markdown: raw,
      body,
    };
  }

  async function readAll(): Promise<ItemWithBody[]> {
    const items: ItemWithBody[] = [];
    for (const status of STATUSES) {
      const dir = folderOf(status);
      for (const file of await filesIn(dir)) {
        if (!MD.test(file)) continue;
        const full = inside(dir, file);
        try {
          const info = await lstat(full);
          if (!info.isFile()) continue; // no symlinks, no folders
          items.push(parse(await readFile(full, "utf8"), file, status));
        } catch {
          // Deleted between readdir and read.
        }
      }
    }
    return items.sort((a, b) => {
      if (a.id && b.id) return Number(a.id) - Number(b.id);
      if (a.id) return -1;
      if (b.id) return 1;
      return a.key.localeCompare(b.key);
    });
  }

  function strip(item: ItemWithBody): Item {
    const { markdown: _m, body: _b, ...rest } = item;
    return rest;
  }

  async function find(key: string): Promise<ItemWithBody> {
    if (!SAFE_NAME.test(key)) throw new StoreError(400, "BAD_ID", "That is not an item id.");
    const items = await readAll();
    const numeric = /^\d+$/.test(key) ? Number(key) : null;
    const item =
      items.find((i) => i.key === key) ??
      (numeric !== null ? items.find((i) => i.id !== null && Number(i.id) === numeric) : undefined);
    if (!item) throw new StoreError(404, "NOT_FOUND", `No item ${key}.`);
    return item;
  }

  /** The highest number used by any file in the five folders or in assets, plus one. */
  async function nextId(): Promise<string> {
    let max = 0;
    const dirs = [...STATUSES.map(folderOf), assetsDir()];
    for (const dir of dirs) {
      for (const file of await filesIn(dir)) {
        const m = file.match(/^(\d+)-/) ?? file.match(/^(\d+)\.md$/i);
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return String(max + 1).padStart(3, "0");
  }

  function decodeScreenshot(dataUrl: string): Buffer {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!m) throw new StoreError(400, "BAD_SCREENSHOT", "The screenshot must be a PNG data URL.");
    const bytes = Buffer.from(m[1], "base64");
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!png) throw new StoreError(400, "BAD_SCREENSHOT", "The screenshot is not a PNG.");
    if (bytes.length > MAX_SCREENSHOT_BYTES) throw new StoreError(413, "SCREENSHOT_TOO_LARGE", "The screenshot is too large.");
    return bytes;
  }

  async function create(input: CreateInput): Promise<ItemWithBody> {
    const title = oneLine(input.title, 200);
    if (!title) throw new StoreError(400, "TITLE_REQUIRED", "An item needs a title.");
    const type = (input.type ?? "task") as ItemType;
    if (!TYPES.includes(type)) throw new StoreError(400, "BAD_TYPE", `type must be one of ${TYPES.join(", ")}.`);
    const priority = (input.priority ?? "normal") as Priority;
    if (!PRIORITIES.includes(priority)) {
      throw new StoreError(400, "BAD_PRIORITY", `priority must be one of ${PRIORITIES.join(", ")}.`);
    }
    const status = (input.status ?? "open") as Status;
    if (!STATUSES.includes(status)) throw new StoreError(400, "BAD_STATUS", `status must be one of ${STATUSES.join(", ")}.`);
    const screenshot = input.context?.screenshot ? decodeScreenshot(input.context.screenshot) : null;
    const recordingExt = input.context?.recording ? recordingExtension(input.context.recording.mimeType) : null;
    if (input.context?.recording && !recordingExt) {
      throw new StoreError(400, "BAD_RECORDING", "A recording must be video/webm or video/mp4.");
    }

    return serialize(async () => {
      await ensureFolders();
      const id = await nextId();
      const file = `${id}-${slugify(title)}.md`;
      const target = inside(folderOf(status), file);
      let screenshotRel: string | null = null;
      let screenshotPath: string | null = null;
      if (screenshot) {
        const name = `${id}-screenshot.png`;
        screenshotPath = inside(assetsDir(), name);
        await writeFile(screenshotPath, screenshot, { flag: "wx" });
        screenshotRel = `${getConfig().folders.assets}/${name}`;
      }
      // The recording's name is set now and written to the file; the video itself follows.
      const recordingRel = recordingExt ? `${getConfig().folders.assets}/${id}-recording.${recordingExt}` : null;
      const markdown = buildMarkdown({ ...input, title, type, priority }, { id, screenshot: screenshotRel, recording: recordingRel, now: localTimestamp() });
      try {
        await writeFile(target, markdown, { flag: "wx" });
      } catch (error) {
        if (screenshotPath) await unlink(screenshotPath).catch(() => undefined);
        throw error;
      }
      return parse(markdown, file, status);
    });
  }

  /**
   * A feedback session as one item in `open/`: `NNN-<title>.md`, with each comment's screenshot as
   * `assets/NNN-comment-01.png` (numbered as the comment is). The first screenshot is the card's.
   */
  async function createSession(input: SessionInput): Promise<ItemWithBody> {
    const title = oneLine(input.title, 200);
    if (!title) throw new StoreError(400, "TITLE_REQUIRED", "A session needs a title.");
    const session = cleanSession(input.session);
    if (!session.comments.length) throw new StoreError(400, "NO_COMMENTS", "The session has no comments.");
    const shots = new Map<string, Buffer>();
    for (const c of session.comments) {
      const data = input.screenshots?.[c.id];
      if (typeof data === "string") shots.set(c.id, decodeScreenshot(data));
    }
    return serialize(async () => {
      await ensureFolders();
      const id = await nextId();
      const assets = getConfig().folders.assets;
      const links = new Map<string, string>();
      const written: string[] = [];
      let cover: string | null = null;
      try {
        for (const c of [...session.comments].sort((a, b) => a.n - b.n)) {
          const bytes = shots.get(c.id);
          if (!bytes) continue;
          const name = `${id}-comment-${String(c.n).padStart(2, "0")}.png`;
          if (written.includes(name)) continue;
          const full = inside(assetsDir(), name);
          await writeFile(full, bytes, { flag: "wx" });
          written.push(name);
          links.set(c.id, `../${assets}/${name}`);
          cover ??= `${assets}/${name}`;
        }
        const file = `${id}-${slugify(title)}.md`;
        const markdown = buildSessionMarkdown(session, {
          id,
          title,
          notes: typeof input.notes === "string" ? input.notes.slice(0, 20_000) : "",
          finished: typeof input.finished === "string" && input.finished ? oneLine(input.finished, 40) : localTimestamp(),
          screenshots: links,
          cover,
          heading: false,
        });
        await writeFile(inside(folderOf("open"), file), markdown, { flag: "wx" });
        return parse(markdown, file, "open");
      } catch (error) {
        for (const name of written) await unlink(inside(assetsDir(), name)).catch(() => undefined);
        throw error;
      }
    });
  }

  async function update(key: string, input: UpdateInput): Promise<ItemWithBody> {
    return serialize(async () => {
      const item = await find(key);
      const full = inside(folderOf(item.status), item.file);
      let next: string;
      if (typeof input.markdown === "string") {
        next = input.markdown;
      } else {
        const changes: Array<[string, string]> = [];
        if (input.title !== undefined) {
          const title = oneLine(input.title, 200);
          if (!title) throw new StoreError(400, "TITLE_REQUIRED", "An item needs a title.");
          changes.push(["title", yamlScalar(title)]);
        }
        if (input.type !== undefined) {
          if (!TYPES.includes(input.type as ItemType)) throw new StoreError(400, "BAD_TYPE", "Unknown type.");
          changes.push(["type", input.type]);
        }
        if (input.priority !== undefined) {
          if (!PRIORITIES.includes(input.priority as Priority)) throw new StoreError(400, "BAD_PRIORITY", "Unknown priority.");
          changes.push(["priority", input.priority]);
        }
        if (!changes.length) throw new StoreError(400, "NOTHING_TO_UPDATE", "Send markdown, title, type or priority.");
        changes.push(["updated", localTimestamp()]);
        const { lines, body } = splitFrontMatter(item.markdown);
        const fmLines = lines ?? [];
        for (const [k, v] of changes) {
          const at = fmLines.findIndex((line) => line.startsWith(`${k}:`));
          if (at >= 0) fmLines[at] = `${k}: ${v}`;
          else fmLines.push(`${k}: ${v}`);
        }
        next = `---\n${fmLines.join("\n")}\n---\n${lines ? body : `\n${body}`}`;
      }
      await writeFile(full, next);
      return parse(next, item.file, item.status);
    });
  }

  async function move(key: string, status: string): Promise<ItemWithBody> {
    if (!STATUSES.includes(status as Status)) {
      throw new StoreError(400, "BAD_STATUS", `status must be one of ${STATUSES.join(", ")}.`);
    }
    return serialize(async () => {
      const item = await find(key);
      if (item.status === status) return item;
      await mkdir(folderOf(status as Status), { recursive: true });
      const from = inside(folderOf(item.status), item.file);
      const to = inside(folderOf(status as Status), item.file);
      try {
        await lstat(to);
        throw new StoreError(409, "NAME_TAKEN", `${item.file} already exists in ${status}/.`);
      } catch (error) {
        if (error instanceof StoreError) throw error;
      }
      await rename(from, to);
      return parse(item.markdown, item.file, status as Status);
    });
  }

  async function remove(key: string): Promise<Item> {
    return serialize(async () => {
      const item = await find(key);
      await unlink(inside(folderOf(item.status), item.file));
      // The screenshot this item made, and only that one.
      const shot = item.screenshot;
      const assets = getConfig().folders.assets;
      if (item.id && shot === `${assets}/${item.id}-screenshot.png`) {
        await unlink(inside(assetsDir(), `${item.id}-screenshot.png`)).catch(() => undefined);
      }
      const own = ownRecording(item);
      if (own) await unlink(inside(assetsDir(), own)).catch(() => undefined);
      // A feedback session's screenshots, which only it uses.
      if (item.id) {
        const mine = new RegExp(`^${item.id}-comment-\\d+\\.png$`);
        for (const name of await filesIn(assetsDir())) if (mine.test(name)) await unlink(inside(assetsDir(), name)).catch(() => undefined);
      }
      return strip(item);
    });
  }

  /** The recording file this item made (`007-recording.webm`), or null for any other path. */
  function ownRecording(item: Item): string | null {
    const assets = getConfig().folders.assets;
    for (const ext of Object.values(RECORDING_TYPES)) {
      const name = `${item.id}-recording.${ext}`;
      if (item.id && item.recording === `${assets}/${name}`) return name;
    }
    return null;
  }

  /**
   * Writes the video for an item whose front matter already names its recording. The body is
   * streamed to a hidden file and renamed into place, so a broken upload leaves nothing behind.
   */
  async function writeRecording(key: string, mimeType: string | undefined, body: AsyncIterable<Buffer> | Buffer): Promise<ItemWithBody> {
    const item = await find(key);
    const name = ownRecording(item);
    if (!name) throw new StoreError(409, "NO_RECORDING", `Item ${key} does not expect a recording.`);
    const ext = recordingExtension(mimeType);
    if (!ext || !name.endsWith(`.${ext}`)) throw new StoreError(415, "BAD_RECORDING", `Send the recording as video/${name.split(".").pop()}.`);
    const target = inside(assetsDir(), name);
    const temp = inside(assetsDir(), `.${name}.part`);
    let size = 0;
    try {
      async function* limited() {
        for await (const chunk of Buffer.isBuffer(body) ? [body] : body) {
          size += chunk.length;
          if (size > MAX_RECORDING_BYTES) throw new StoreError(413, "RECORDING_TOO_LARGE", "The recording is larger than 2 GB.");
          yield chunk;
        }
      }
      await pipeline(limited(), createWriteStream(temp));
      if (!size) throw new StoreError(400, "EMPTY_RECORDING", "The recording is empty.");
      await rename(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    return item;
  }

  async function assetFile(name: string): Promise<string> {
    if (!SAFE_NAME.test(name)) throw new StoreError(400, "BAD_NAME", "Bad asset name.");
    const full = inside(assetsDir(), name);
    const info = await lstat(full).catch(() => null);
    if (!info || !info.isFile()) throw new StoreError(404, "NOT_FOUND", "No such asset.");
    return full;
  }

  async function counts(): Promise<Record<Status, number>> {
    const result = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    for (const item of await readAll()) result[item.status] += 1;
    return result;
  }

  return {
    root,
    ensureFolders,
    list: async () => (await readAll()).map(strip),
    get: find,
    create,
    createSession,
    update,
    move,
    remove,
    writeRecording,
    assetFile,
    counts,
    nextId,
  };
}

export type Store = ReturnType<typeof createStore>;
