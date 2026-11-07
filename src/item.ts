/**
 * How an item becomes a Markdown file. Shared by the Node backend (which writes it into the data
 * folder) and the widget with no backend (which downloads it), so both produce the same file.
 * No Node or DOM APIs here.
 */

/** What the widget sends to `POST /api/items`, and what it formats itself when it has no backend. */
export interface CreateInput {
  type?: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  context?: {
    page?: { path?: string; title?: string; origin?: string };
    browser?: { browser?: string; viewport?: string; devicePixelRatio?: number; touch?: boolean };
    console?: Array<{ level?: string; message?: string; source?: string }>;
    element?: {
      tag?: string;
      id?: string;
      classes?: string[];
      text?: string;
      selector?: string;
      html?: string;
      rect?: { x: number; y: number; w: number; h: number };
    };
    screenshot?: string;
    /** A recording to come: the file itself follows with `PUT /api/items/:id/recording`. */
    recording?: { mimeType?: string; duration?: number };
  };
}

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019"\u201c\u201d]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 7)
    .join("-")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

/** A local timestamp with its offset, e.g. 2026-11-02T10:12:00+05:30. */
export function localTimestamp(date = new Date()): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

/** A YAML scalar: plain when that reads back as the same string, double-quoted otherwise. */
export function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(yamlScalar).join(", ")}]`;
  const s = String(value);
  const risky =
    s === "" ||
    /^\s|\s$/.test(s) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /: |\s#|:$/.test(s) ||
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(s) ||
    /^(true|false|yes|no|on|off|null|y|n|~)$/i.test(s) ||
    // Reads back as a number, a date or a time: 12, 1e3, 0x1f, .5, 2026-11-02, 12:30.
    /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|0x[0-9a-f]+|0o[0-7]+|\.inf|\.nan)$/i.test(s) ||
    /^\d{4}-\d\d?-\d\d?/.test(s) ||
    /^[-+]?\d+(:[0-5]?\d)+(\.\d*)?$/.test(s);
  return risky ? JSON.stringify(s) : s;
}

/** Backticks that cannot be closed by the text inside them. */
function inlineCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

export function oneLine(text: unknown, max: number): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 151 seconds as 2:31, an hour or more as 1:02:31. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export interface MarkdownOptions {
  /** The three-digit id; left out of the front matter when null (a downloaded item has none). */
  id: string | null;
  /** The screenshot's path relative to the data folder, e.g. `assets/001-screenshot.png`. */
  screenshot: string | null;
  /** The recording's path the same way, e.g. `assets/001-recording.webm`. */
  recording?: string | null;
  /** The `created` and `updated` timestamp. */
  now: string;
}

/** The item's file: front matter, then the description and a section per attached context. */
export function buildMarkdown(input: CreateInput, o: MarkdownOptions): string {
  const ctx = input.context ?? {};
  const fm: Array<[string, unknown]> = [];
  if (o.id) fm.push(["id", o.id]);
  fm.push(["title", oneLine(input.title, 200)], ["type", input.type], ["priority", input.priority], ["created", o.now], ["updated", o.now]);
  if (ctx.page) {
    if (ctx.page.path) fm.push(["page", oneLine(ctx.page.path, 500)]);
    if (ctx.page.title) fm.push(["pageTitle", oneLine(ctx.page.title, 200)]);
    if (ctx.page.origin) fm.push(["origin", oneLine(ctx.page.origin, 200)]);
  }
  if (ctx.browser) {
    if (ctx.browser.viewport) fm.push(["viewport", oneLine(ctx.browser.viewport, 40)]);
    if (typeof ctx.browser.devicePixelRatio === "number") {
      fm.push(["devicePixelRatio", Math.round(ctx.browser.devicePixelRatio * 100) / 100]);
    }
    if (ctx.browser.browser) fm.push(["browser", oneLine(ctx.browser.browser, 120)]);
    if (typeof ctx.browser.touch === "boolean") fm.push(["touch", ctx.browser.touch]);
  }
  if (o.screenshot) fm.push(["screenshot", o.screenshot]);
  const duration = Number(ctx.recording?.duration);
  if (o.recording) {
    fm.push(["recording", o.recording]);
    if (Number.isFinite(duration) && duration > 0) fm.push(["recordingDuration", formatDuration(duration)]);
  }
  const el = ctx.element;
  if (el && el.selector) {
    const tag = oneLine(el.tag || "element", 40).toLowerCase();
    const classes = (el.classes ?? []).slice(0, 4).map((c) => `.${oneLine(c, 60)}`).join("");
    const idPart = el.id ? `#${oneLine(el.id, 60)}` : "";
    fm.push(["element", `${tag}${idPart}${classes}  (${oneLine(el.selector, 300)})`]);
    const r = el.rect;
    if (r && [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n))) {
      fm.push(["elementRect", [r.x, r.y, r.w, r.h].map((n) => Math.round(n * 10000) / 10000)]);
    }
  }
  if (Array.isArray(ctx.console)) fm.push(["consoleErrors", Math.min(ctx.console.length, 20)]);

  const yaml = fm.map(([k, v]) => `${k}: ${k === "id" || k === "created" || k === "updated" ? v : yamlScalar(v)}`);
  const parts: string[] = [];
  const description = String(input.description ?? "").replace(/\r\n/g, "\n").trim();
  if (description) parts.push(description);
  if (o.recording) {
    const length = Number.isFinite(duration) && duration > 0 ? `, ${formatDuration(duration)}` : "";
    parts.push(`[Screen recording${length}](../${o.recording})`);
  }
  // Items sit one folder below the data folder, so the image link climbs one level: it then
  // shows on GitHub and in an editor's preview from whichever status folder the file is in.
  if (o.screenshot) parts.push(`![Screenshot](../${o.screenshot})`);
  if (el && el.selector) {
    const html = oneLine(el.html || `<${el.tag ?? "element"}>`, 300);
    const text = el.text ? ` — text ${inlineCode(oneLine(el.text, 120))}` : "";
    parts.push(`## Selected element\n${inlineCode(html)} — selector ${inlineCode(oneLine(el.selector, 300))}${text}`);
  }
  if (Array.isArray(ctx.console)) {
    const lines = ctx.console.slice(-20).map((entry) => {
      const message = oneLine(entry.message, 400);
      const label = entry.level === "error" ? "Error" : "Warning";
      const prefixed = /^(warning|error|uncaught|unhandled)\b/i.test(message) ? message : `${label}: ${message}`;
      return `- ${prefixed}${entry.source ? ` (${oneLine(entry.source, 120)})` : ""}`;
    });
    parts.push(`## Console errors at the time\n${lines.length ? lines.join("\n") : "None since the page loaded."}`);
  }
  return `---\n${yaml.join("\n")}\n---\n\n${parts.join("\n\n")}\n`;
}
