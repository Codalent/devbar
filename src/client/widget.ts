import {
  DEFAULT_TOGGLES,
  DIR_NAME,
  ELEMENT_NAME,
  GLOBAL_NAME,
  NAME,
  PACKAGE,
  STATUSES,
  STATUS_LABELS,
  STORAGE_PREFIX,
  type ContextKey,
  type ItemType,
  type Position,
  type Priority,
  type Status,
  type Toggles,
  type WidgetConfig,
} from "../name.js";
import {
  browserInfo,
  captureScreenshot,
  consoleEntries,
  describeElement,
  pageInfo,
  selectorFor,
  type PickedElement,
} from "./context.js";
import { esc, renderMarkdown } from "./markdown.js";
import { CSS } from "./styles.js";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";

interface Item {
  id: string | null;
  key: string;
  file: string;
  status: Status;
  path: string;
  title: string;
  type: ItemType;
  priority: Priority;
  page: string | null;
  screenshot: string | null;
  created: string | null;
  hasFrontMatter: boolean;
  frontMatter: Record<string, unknown>;
}
interface FullItem extends Item {
  markdown: string;
  body: string;
}

type Edge = "left" | "right" | "top" | "bottom" | "corner" | "free";
interface Pos {
  x: number;
  y: number;
  edge: Edge;
}

const SIZE = 36;
const M = 16;
const CORNER = 110;
const TYPE_COLOR: Record<ItemType, string> = { bug: "var(--bug)", task: "var(--task)", idea: "var(--idea)" };
const OFFLINE = `Not connected. Run npx ${PACKAGE} in the project folder.`;

const ICON_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
const ICON_PEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_BOARD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1.2"/><rect x="9.5" y="4" width="5" height="11" rx="1.2"/><rect x="16" y="4" width="5" height="7" rx="1.2"/></svg>`;

const TEMPLATE = `
<div class="root">
  <button class="dot" aria-label="${NAME}" aria-expanded="false">${ICON_PLUS}<span class="badge" hidden>0</span></button>
  <div class="tip" role="tooltip">Not connected. Run <code>npx ${PACKAGE}</code> in the project folder.</div>
  <div class="pills h rev">
    <button class="pill glass" data-act="new">${ICON_PEN}New task<kbd>N</kbd></button>
    <button class="pill glass" data-act="board">${ICON_BOARD}Board<kbd>B</kbd></button>
  </div>

  <div class="form glass" role="dialog" aria-label="New item">
    <header>
      <div class="seg types" role="group" aria-label="Type">
        <button data-type="task" aria-pressed="true"><i style="background:var(--task)"></i>Task</button>
        <button data-type="bug" aria-pressed="false"><i style="background:var(--bug)"></i>Bug</button>
        <button data-type="idea" aria-pressed="false"><i style="background:var(--idea)"></i>Idea</button>
      </div>
      <button class="x" data-act="hide-form" aria-label="Close">×</button>
    </header>
    <div class="body">
      <label class="f">Title<input type="text" name="title" autocomplete="off" spellcheck="true"></label>
      <label class="f">Description<textarea name="desc" placeholder="Steps, what you expected, anything else (Markdown)"></textarea></label>
      <div class="row"><span class="lbl">Priority</span>
        <div class="seg small prio" role="group" aria-label="Priority">
          <button data-p="low" aria-pressed="false">Low</button>
          <button data-p="normal" aria-pressed="true">Normal</button>
          <button data-p="high" aria-pressed="false">High</button>
        </div>
      </div>
      <div class="attach">
        <h4>Attach</h4>
        <div class="tog" data-k="screenshot"><button class="sw" role="switch" aria-checked="false" aria-label="Screenshot"></button><div><div class="t">Screenshot</div><div class="d"></div></div><div class="thumb" aria-hidden="true"></div></div>
        <div class="tog" data-k="page"><button class="sw" role="switch" aria-checked="false" aria-label="Page"></button><div><div class="t">Page</div><div class="d"></div></div><div></div></div>
        <div class="tog" data-k="browser"><button class="sw" role="switch" aria-checked="false" aria-label="Browser and window"></button><div><div class="t">Browser and window</div><div class="d"></div></div><div></div></div>
        <div class="tog" data-k="console"><button class="sw" role="switch" aria-checked="false" aria-label="Console errors"></button><div><div class="t">Console errors</div><div class="d"></div></div><div></div></div>
        <div class="tog" data-k="element"><button class="sw" role="switch" aria-checked="false" aria-label="Selected element"></button><div><div class="t">Selected element</div><div class="d"></div></div><button class="pick" data-act="pick">Pick</button></div>
      </div>
    </div>
    <footer><span class="path"></span><button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="save">Save</button></footer>
  </div>

  <section class="board glass" aria-label="Board">
    <header>
      <h2>Board</h2>
      <span class="path"></span>
      <div class="filters" role="group" aria-label="Filter">
        <button data-f="all" aria-pressed="true">All</button>
        <button data-f="task" aria-pressed="false"><i style="background:var(--task)"></i>Tasks</button>
        <button data-f="bug" aria-pressed="false"><i style="background:var(--bug)"></i>Bugs</button>
        <button data-f="idea" aria-pressed="false"><i style="background:var(--idea)"></i>Ideas</button>
      </div>
      <span class="sp"></span>
      <span class="live"><i></i><span>watching folder</span></span>
      <button class="btn" data-act="board-new">New</button>
      <button class="x" data-act="close-board" aria-label="Close board">×</button>
    </header>
    <div class="notice" hidden></div>
    <div class="cols"></div>
    <aside class="drawer" aria-label="Item">
      <header><span class="file"></span><span class="acts"></span><button class="x" data-act="close-drawer" aria-label="Close">×</button></header>
      <div class="md"></div>
      <textarea class="raw" hidden spellcheck="false" aria-label="Markdown"></textarea>
      <div class="move"></div>
    </aside>
  </section>

  <div class="veil"></div>
  <div class="pickbox"></div>
  <div class="picklabel"></div>
  <div class="pickhint glass">Click an element to attach it. <kbd>Esc</kbd> cancels.</div>
  <div class="toast glass" role="status" aria-live="polite"><i></i><span></span></div>
</div>`;

function store<T>(key: string, value?: T): T | null {
  try {
    if (value === undefined) {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // storage blocked: the toolbar still works, it just forgets
  }
  return null;
}

function slugify(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/['’"“”]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 7)
      .join("-")
      .slice(0, 60)
      .replace(/-+$/g, "") || "untitled"
  );
}

/** A host element the page's CSS cannot move, hide or restyle. */
const HOST_STYLE = [
  "all:initial",
  "position:fixed",
  "left:0",
  "top:0",
  "width:0",
  "height:0",
  "margin:0",
  "padding:0",
  "border:0",
  "display:block",
  "overflow:visible",
  "visibility:visible",
  "opacity:1",
  "transform:none",
  "filter:none",
  "contain:none",
  "pointer-events:auto",
  "z-index:2147483600",
]
  .map((d) => `${d} !important`)
  .join(";");

export class Toolbar {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly server: string;
  /** Sent with every request: a header where it can be, a `key` parameter where it cannot. */
  private readonly key: string | null;

  private connected = false;
  private noticed = false;
  private retryDelay = 2000;
  private retriesLeft = 5;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private lastAttempt = 0;
  private connecting = false;
  private events: EventSource | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  private config: WidgetConfig | null = null;
  private items: Item[] = [];
  private pos: Pos = { x: 0, y: 0, edge: "corner" };
  private open = false;
  private drag: { sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;
  private justDragged = false;

  private formOpen = false;
  private type: ItemType = "task";
  private priority: Priority = "normal";
  private shot: { state: "idle" | "busy" | "done" | "error"; dataUrl?: string; error?: string; promise?: Promise<void> } = { state: "idle" };
  private shotRun = 0;
  private browser: Awaited<ReturnType<typeof browserInfo>> | null = null;
  private picked: PickedElement | null = null;
  private picking = false;
  private saving = false;

  private boardOpen = false;
  private filter: "all" | ItemType = "all";
  private drawer: FullItem | null = null;
  private editing = false;
  private deleteArmed: ReturnType<typeof setTimeout> | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(server: string, key?: string) {
    this.server = server.replace(/\/+$/, "");
    this.key = key || null;
    if (!customElements.get(ELEMENT_NAME)) customElements.define(ELEMENT_NAME, class extends HTMLElement {});
    this.host = document.createElement(ELEMENT_NAME);
    this.host.setAttribute("style", HOST_STYLE);
    this.host.setAttribute("data-version", VERSION);
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${CSS}</style>${TEMPLATE}`;
    this.restorePosition();
    this.bind();
  }

  // ------------------------------------------------------------------ lifecycle

  mount(): void {
    document.body.appendChild(this.host);
    // Some frameworks replace the body's children on hydration; come back if that happens.
    this.observer = new MutationObserver(() => {
      if (!this.host.isConnected && document.body) document.body.appendChild(this.host);
    });
    this.observer.observe(document.body, { childList: true });
    this.placeDot();
    this.renderToggles();
    void this.connect();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.events?.close();
    clearTimeout(this.retryTimer);
    this.cleanups.forEach((fn) => fn());
    this.host.remove();
  }

  // ------------------------------------------------------------------ helpers

  private $<T extends Element = HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }
  private $$<T extends Element = HTMLElement>(sel: string): T[] {
    return [...this.root.querySelectorAll(sel)] as T[];
  }
  private listen<E extends Event>(target: Window | Document, type: string, fn: (e: E) => void, capture = false) {
    target.addEventListener(type, fn as EventListener, capture);
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, capture));
  }

  private keyHeader(): Record<string, string> {
    return this.key ? { "X-Devbar-Key": this.key } : {};
  }

  /** For the event stream and images, which cannot send a header. */
  private withKey(url: string): string {
    return this.key ? `${url}?key=${encodeURIComponent(this.key)}` : url;
  }

  private async api<T = Record<string, unknown>>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const { json, ...rest } = init;
    let res: Response;
    try {
      res = await fetch(this.server + path, {
        ...rest,
        cache: "no-store",
        headers: { ...this.keyHeader(), ...(json !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
    } catch {
      this.lostConnection();
      throw new Error(OFFLINE);
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message || `${res.status} ${res.statusText}`);
    return body;
  }

  private toast(text: string, code?: string, bad = false) {
    const t = this.$(".toast");
    t.classList.toggle("bad", bad);
    this.$(".toast span").innerHTML = esc(text) + (code ? ` <code>${esc(code)}</code>` : "");
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove("show"), bad ? 4200 : 2800);
  }

  private get dir(): string {
    return this.config?.dir ?? DIR_NAME;
  }

  // ------------------------------------------------------------------ connection

  private async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    this.lastAttempt = Date.now();
    clearTimeout(this.retryTimer);
    try {
      const res = await fetch(`${this.server}/api/health`, { cache: "no-store", headers: this.keyHeader() });
      if (!res.ok) throw new Error(String(res.status));
      const health = (await res.json()) as { config?: WidgetConfig };
      if (health.config) this.applyConfig(health.config);
      this.setConnected(true);
      this.retryDelay = 2000;
      this.retriesLeft = 5;
      await this.refresh();
      this.openEvents();
    } catch {
      this.lostConnection();
    } finally {
      this.connecting = false;
    }
  }

  private lostConnection() {
    this.events?.close();
    this.events = null;
    this.setConnected(false);
    if (!this.noticed) {
      this.noticed = true;
      // The one console line: quiet, and never repeated while the page is open.
      console.info(`[${NAME}] Not connected to ${this.server}. Run \`npx ${PACKAGE}\` in the project folder; the toolbar reconnects on its own.`);
    }
    // Back off: 2, 4, 8, 16 and 32 s, then stop polling. The browser itself logs every refused
    // request, which no script can silence, so after that the toolbar only retries when the tab
    // regains focus or becomes visible, or the dot is hovered or clicked: the moment someone comes
    // back from restarting the server.
    clearTimeout(this.retryTimer);
    if (this.retriesLeft <= 0) return;
    this.retriesLeft--;
    this.retryTimer = setTimeout(() => void this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
  }

  private retrySoon() {
    if (this.connected || this.connecting || Date.now() - this.lastAttempt < 3000) return;
    void this.connect();
  }

  private openEvents() {
    this.events?.close();
    const es = new EventSource(this.withKey(`${this.server}/api/events`));
    this.events = es;
    es.addEventListener("change", () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => void this.refresh(true), 60);
    });
    es.addEventListener("config", (e) => {
      try {
        this.applyConfig(JSON.parse((e as MessageEvent).data));
      } catch {
        // ignore a malformed frame
      }
    });
    es.addEventListener("open", () => this.$(".live").classList.add("on"));
    es.onerror = () => {
      // Close at once: EventSource would retry every few seconds and fill the console.
      if (this.events === es) this.lostConnection();
      else es.close();
    };
  }

  private setConnected(on: boolean) {
    this.connected = on;
    const dot = this.$(".dot");
    dot.classList.toggle("off", !on);
    dot.setAttribute("aria-label", on ? NAME : `${NAME}: ${OFFLINE}`);
    this.$(".live").classList.toggle("on", on && !!this.events);
    this.$(".live span").textContent = on ? "watching folder" : "not connected";
    const notice = this.$(".board .notice");
    notice.hidden = on;
    notice.textContent = OFFLINE;
    if (!on) {
      this.setOpen(false);
      this.$(".badge").hidden = true;
    }
  }

  private applyConfig(config: WidgetConfig) {
    const first = !this.config;
    this.config = config;
    this.$(".board header .path").textContent = `${config.dir}/ in ${config.project}`;
    if (first && !store("position")) this.restorePosition();
    this.renderToggles();
    this.updatePath();
  }

  private async refresh(fromDisk = false): Promise<void> {
    if (!this.connected) return;
    try {
      const data = await this.api<{ items: Item[] }>("/api/items");
      this.items = data.items;
      this.updateBadge();
      if (this.boardOpen) this.renderBoard();
      if (this.drawer && !this.editing && fromDisk) {
        const still = this.items.find((i) => i.key === this.drawer!.key);
        if (still) void this.openDrawer(still.key, true);
        else this.closeDrawer();
      }
      this.updatePath();
    } catch {
      // lostConnection has already been told
    }
  }

  private updateBadge() {
    const n = this.items.filter((i) => i.status === "open" || i.status === "in-progress").length;
    const badge = this.$(".badge");
    badge.textContent = String(n);
    badge.hidden = !this.connected || n === 0;
  }

  // ------------------------------------------------------------------ the dot: position, drag, snap

  private W = () => document.documentElement.clientWidth || window.innerWidth;
  private H = () => document.documentElement.clientHeight || window.innerHeight;

  /** Nearest edge keeps the position along it; near a corner, the corner wins. */
  private snapTarget(x: number, y: number): Pos {
    const maxX = this.W() - M - SIZE;
    const maxY = this.H() - M - SIZE;
    x = Math.min(Math.max(M, x), maxX);
    y = Math.min(Math.max(M, y), maxY);
    const dl = x - M;
    const dr = maxX - x;
    const dt = y - M;
    const db = maxY - y;
    const nearX = Math.min(dl, dr);
    const nearY = Math.min(dt, db);
    const sx = dl < dr ? M : maxX;
    const sy = dt < db ? M : maxY;
    if (nearX < CORNER && nearY < CORNER) return { x: sx, y: sy, edge: "corner" };
    return nearX <= nearY ? { x: sx, y, edge: dl < dr ? "left" : "right" } : { x, y: sy, edge: dt < db ? "top" : "bottom" };
  }

  private savePosition() {
    const { x, y, edge } = this.pos;
    const spanX = Math.max(1, this.W() - 2 * M - SIZE);
    const spanY = Math.max(1, this.H() - 2 * M - SIZE);
    if (edge === "corner") store("position", { corner: `${y < this.H() / 2 ? "top" : "bottom"}-${x < this.W() / 2 ? "left" : "right"}` });
    else if (edge === "left" || edge === "right") store("position", { edge, t: (y - M) / spanY });
    else store("position", { edge, t: (x - M) / spanX });
  }

  private restorePosition() {
    const saved = store<{ corner?: Position; edge?: Edge; t?: number }>("position");
    const W = this.W();
    const H = this.H();
    const maxX = W - M - SIZE;
    const maxY = H - M - SIZE;
    const corner = (c: string): Pos => ({ x: c.endsWith("left") ? M : maxX, y: c.startsWith("top") ? M : maxY, edge: "corner" });
    if (saved?.corner) this.pos = corner(saved.corner);
    else if (saved?.edge && typeof saved.t === "number") {
      const t = Math.min(1, Math.max(0, saved.t));
      const along = (span: number) => M + t * span;
      if (saved.edge === "left" || saved.edge === "right") this.pos = { x: saved.edge === "left" ? M : maxX, y: along(H - 2 * M - SIZE), edge: saved.edge };
      else this.pos = { x: along(W - 2 * M - SIZE), y: saved.edge === "top" ? M : maxY, edge: saved.edge };
      this.pos = this.snapTarget(this.pos.x, this.pos.y);
    } else this.pos = corner(this.config?.position ?? "bottom-right");
    if (this.host.isConnected) this.placeDot();
  }

  private placeDot() {
    const dot = this.$(".dot");
    dot.style.left = `${this.pos.x}px`;
    dot.style.top = `${this.pos.y}px`;
    this.placePills();
    this.placeTip();
    if (this.formOpen) this.placeForm();
  }

  private placeTip() {
    const tip = this.$(".tip");
    const right = this.pos.x > this.W() / 2;
    tip.style.top = `${this.pos.y + SIZE / 2}px`;
    tip.style.transform = "translateY(-50%)";
    tip.style.left = right ? "" : `${this.pos.x + SIZE + 10}px`;
    tip.style.right = right ? `${this.W() - this.pos.x + 10}px` : "";
  }

  private placePills() {
    const pills = this.$(".pills");
    const W = this.W();
    const H = this.H();
    const { x, y, edge } = this.pos;
    const right = x > W / 2;
    const below = y > H / 2;
    const horizontal = edge === "top" || edge === "bottom" || edge === "corner";
    pills.classList.toggle("h", horizontal);
    pills.classList.toggle("v", !horizontal);
    pills.classList.toggle("rev", horizontal ? right : below);
    pills.style.left = pills.style.right = pills.style.top = pills.style.bottom = "";
    pills.style.alignItems = !horizontal ? (right ? "flex-end" : "flex-start") : "";
    const gap = 10;
    const pillsList = this.$$(".pill");
    if (horizontal) {
      pills.style.top = `${y + (SIZE - 34) / 2}px`;
      if (right) pills.style.right = `${W - x + gap}px`;
      else pills.style.left = `${x + SIZE + gap}px`;
      pillsList.forEach((p) => {
        p.style.setProperty("--dx", `${right ? 14 : -14}px`);
        p.style.setProperty("--dy", "0px");
      });
    } else {
      if (right) pills.style.right = `${W - x - SIZE}px`;
      else pills.style.left = `${x}px`;
      if (below) pills.style.bottom = `${H - y + gap}px`;
      else pills.style.top = `${y + SIZE + gap}px`;
      pillsList.forEach((p) => {
        p.style.setProperty("--dy", `${below ? 14 : -14}px`);
        p.style.setProperty("--dx", "0px");
      });
    }
  }

  private setOpen(on: boolean) {
    if (on && !this.connected) on = false;
    this.open = on;
    const dot = this.$(".dot");
    dot.classList.toggle("open", on);
    dot.setAttribute("aria-expanded", String(on));
    this.placePills();
    this.$(".pills").classList.toggle("show", on);
  }

  // ------------------------------------------------------------------ events

  private bind() {
    const dot = this.$(".dot");
    dot.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.drag = { sx: e.clientX, sy: e.clientY, ox: this.pos.x, oy: this.pos.y, moved: false };
      dot.setPointerCapture(e.pointerId);
      dot.classList.remove("snapping");
    });
    dot.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 4) {
        d.moved = true;
        dot.classList.add("dragging");
        this.setOpen(false);
        this.$(".tip").classList.remove("show");
        if (this.formOpen) this.hideForm();
      }
      if (d.moved) {
        this.pos = { x: d.ox + dx, y: d.oy + dy, edge: "free" };
        dot.style.left = `${this.pos.x}px`;
        dot.style.top = `${this.pos.y}px`;
      }
    });
    const endDrag = () => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      dot.classList.remove("dragging");
      if (d.moved) {
        this.justDragged = true;
        setTimeout(() => (this.justDragged = false), 0);
        this.pos = this.snapTarget(this.pos.x, this.pos.y);
        dot.classList.add("snapping");
        this.placeDot();
        this.savePosition();
      }
    };
    dot.addEventListener("pointerup", endDrag);
    dot.addEventListener("pointercancel", endDrag);
    dot.addEventListener("click", () => {
      if (this.justDragged) return;
      if (!this.connected) {
        this.$(".tip").classList.add("show");
        this.retrySoon();
        return;
      }
      if (this.formOpen) return this.hideForm();
      if (this.boardOpen) return this.closeBoard();
      this.setOpen(!this.open);
    });
    dot.addEventListener("mouseenter", () => {
      if (!this.connected) {
        this.placeTip();
        this.$(".tip").classList.add("show");
        this.retrySoon();
      }
    });
    dot.addEventListener("mouseleave", () => this.$(".tip").classList.remove("show"));

    this.root.addEventListener("click", (e) => {
      const target = (e.target as Element).closest<HTMLElement>("[data-act]");
      if (!target) return;
      switch (target.dataset.act) {
        case "new":
          return this.openForm("task");
        case "board":
          return this.openBoard();
        case "hide-form":
          return this.hideForm();
        case "cancel":
          return this.cancelForm();
        case "save":
          return void this.save();
        case "pick":
          return this.startPick();
        case "board-new":
          this.closeBoard();
          return this.openForm("task");
        case "close-board":
          return this.closeBoard();
        case "close-drawer":
          return this.closeDrawer();
        case "edit":
          return this.startEdit();
        case "save-edit":
          return void this.saveEdit();
        case "cancel-edit":
          this.editing = false;
          return this.drawer && this.renderDrawer(this.drawer);
        case "delete":
          return void this.deleteItem(target);
      }
    });

    this.$$<HTMLButtonElement>(".types button").forEach((b) => b.addEventListener("click", () => this.setType(b.dataset.type as ItemType)));
    this.$$<HTMLButtonElement>(".prio button").forEach((b) =>
      b.addEventListener("click", () => {
        this.priority = b.dataset.p as Priority;
        this.$$(".prio button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      }),
    );
    this.$$<HTMLButtonElement>(".tog .sw").forEach((sw) =>
      sw.addEventListener("click", () => {
        const key = sw.closest<HTMLElement>(".tog")!.dataset.k as ContextKey;
        if (key === "element" && this.type !== "bug") return;
        const toggles = this.toggles(this.type);
        toggles[key] = sw.getAttribute("aria-checked") !== "true";
        const saved = store<Record<string, Toggles>>("toggles") ?? {};
        saved[this.type] = toggles;
        store("toggles", saved);
        this.renderToggles();
      }),
    );
    const title = this.$<HTMLInputElement>("input[name=title]");
    title.addEventListener("input", () => {
      title.classList.remove("invalid");
      this.updatePath();
    });
    this.$$<HTMLButtonElement>(".filters button").forEach((b) =>
      b.addEventListener("click", () => {
        this.filter = b.dataset.f as "all" | ItemType;
        this.$$(".filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        this.renderBoard();
      }),
    );

    // element picker
    const veil = this.$(".veil");
    veil.addEventListener("mousemove", (e) => this.pickMove(e));
    veil.addEventListener("click", (e) => this.pickClick(e));

    this.listen<KeyboardEvent>(window, "keydown", (e) => this.onKey(e), true);
    this.listen<PointerEvent>(
      document,
      "pointerdown",
      (e) => {
        if (this.picking || e.composedPath().includes(this.host)) return;
        this.setOpen(false);
        if (this.formOpen && !this.saving && !this.hasDraft()) this.hideForm();
      },
      true,
    );
    this.listen(window, "resize", () => {
      this.pos = this.snapTarget(this.pos.x, this.pos.y);
      this.placeDot();
    });
    this.listen(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") this.retrySoon();
    });
    this.listen(window, "focus", () => this.retrySoon());
  }

  private onKey(e: KeyboardEvent) {
    const path = e.composedPath();
    const target = path[0] as HTMLElement | undefined;
    const typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
    const inside = path.includes(this.host);
    if (e.key === "Escape") {
      if (this.picking) this.endPick();
      else if (this.editing && this.drawer) {
        this.editing = false;
        this.renderDrawer(this.drawer);
      } else if (this.drawer) this.closeDrawer();
      else if (this.boardOpen) this.closeBoard();
      else if (this.formOpen) this.hideForm();
      else if (this.open) this.setOpen(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.matchShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (this.boardOpen) this.closeBoard();
      else this.openBoard();
      return;
    }
    if (inside && this.formOpen && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void this.save();
      return;
    }
    if (this.open && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        this.openForm("task");
      } else if (k === "b") {
        e.preventDefault();
        this.openBoard();
      }
    }
  }

  /** `mod+shift+.` by default; `mod` is Ctrl or ⌘. */
  private matchShortcut(e: KeyboardEvent): boolean {
    const spec = (this.config?.shortcut ?? "mod+shift+.").toLowerCase().split("+").map((s) => s.trim());
    const key = spec[spec.length - 1];
    const mods = new Set(spec.slice(0, -1));
    const wantMod = mods.has("mod");
    if (wantMod ? !(e.metaKey || e.ctrlKey) : e.metaKey !== mods.has("meta") || e.ctrlKey !== mods.has("ctrl")) return false;
    if (e.shiftKey !== mods.has("shift") || e.altKey !== mods.has("alt")) return false;
    const codes: Record<string, string> = { ".": "Period", ",": "Comma", "/": "Slash", ";": "Semicolon", "'": "Quote", "`": "Backquote", "[": "BracketLeft", "]": "BracketRight", "-": "Minus", "=": "Equal" };
    if (codes[key]) return e.code === codes[key] || e.key === key;
    if (/^[a-z]$/.test(key)) return e.code === `Key${key.toUpperCase()}` || e.key.toLowerCase() === key;
    if (/^\d$/.test(key)) return e.code === `Digit${key}` || e.key === key;
    return e.key.toLowerCase() === key;
  }

  // ------------------------------------------------------------------ the form

  private toggles(type: ItemType): Toggles {
    const saved = store<Record<string, Partial<Toggles>>>("toggles") ?? {};
    return { ...DEFAULT_TOGGLES[type], ...(this.config?.toggles?.[type] ?? {}), ...(saved[type] ?? {}) };
  }

  private hasDraft(): boolean {
    return !!(this.$<HTMLInputElement>("input[name=title]").value.trim() || this.$<HTMLTextAreaElement>("textarea[name=desc]").value.trim() || this.picked);
  }

  private setType(type: ItemType) {
    this.type = type;
    this.$$(".types button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === type)));
    this.$<HTMLInputElement>("input[name=title]").placeholder = { bug: "What did you see?", task: "What should be done?", idea: "What is the idea?" }[type];
    this.renderToggles();
  }

  private openForm(type: ItemType) {
    if (!this.connected) {
      this.toast(OFFLINE, undefined, true);
      this.retrySoon();
      return;
    }
    this.setOpen(false);
    if (this.boardOpen) this.closeBoard();
    const wasOpen = this.formOpen;
    this.formOpen = true;
    if (!wasOpen) {
      this.setType(this.hasDraft() ? this.type : type);
      this.takeScreenshot();
      this.browser = null;
      void browserInfo().then((info) => {
        this.browser = info;
        this.renderToggles();
      });
    }
    const form = this.$(".form");
    form.classList.add("show");
    this.renderToggles();
    this.updatePath();
    this.placeForm();
    setTimeout(() => this.$<HTMLInputElement>("input[name=title]").focus(), 30);
  }

  /** Close without writing; the typed text stays for next time, the screenshot does not. */
  private hideForm() {
    this.formOpen = false;
    this.endPick();
    this.$(".form").classList.remove("show");
    this.shotRun++;
    this.shot = { state: "idle" };
  }

  private cancelForm() {
    this.hideForm();
    this.resetDraft();
    this.toast("Discarded. Nothing was written.");
  }

  private resetDraft() {
    this.$<HTMLInputElement>("input[name=title]").value = "";
    this.$<HTMLTextAreaElement>("textarea[name=desc]").value = "";
    this.picked = null;
    this.priority = "normal";
    this.$$(".prio button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.p === "normal")));
    this.updatePath();
  }

  private takeScreenshot() {
    const run = ++this.shotRun;
    this.shot = { state: "busy" };
    this.renderToggles();
    const promise = captureScreenshot(this.host)
      .then((r) => {
        if (run !== this.shotRun) return;
        this.shot = { state: "done", dataUrl: r.dataUrl };
      })
      .catch((error: unknown) => {
        if (run !== this.shotRun) return;
        this.shot = { state: "error", error: (error as Error)?.message || "unknown error" };
      })
      .finally(() => {
        if (run === this.shotRun) this.renderToggles();
      });
    this.shot.promise = promise;
  }

  private placeForm() {
    const form = this.$(".form");
    const W = this.W();
    const H = this.H();
    const { x, y, edge } = this.pos;
    const right = x > W / 2;
    const below = y > H / 2;
    form.style.left = form.style.right = form.style.top = form.style.bottom = "";
    if (edge === "left" || edge === "right") {
      // Beside the dot, centred on it, inside the window.
      if (right) form.style.right = `${W - x + 12}px`;
      else form.style.left = `${x + SIZE + 12}px`;
      form.style.maxHeight = `${H - 16}px`;
      const h = Math.min(form.offsetHeight || 520, H - 16);
      form.style.top = `${Math.min(Math.max(8, y + SIZE / 2 - h / 2), H - h - 8)}px`;
      form.style.setProperty("--ox", right ? "100%" : "0%");
      form.style.setProperty("--oy", "50%");
      return;
    }
    if (right) form.style.right = `${Math.max(8, W - x - SIZE)}px`;
    else form.style.left = `${Math.max(8, x)}px`;
    if (below) {
      form.style.bottom = `${H - y + 12}px`;
      form.style.maxHeight = `${Math.max(200, y - 12 - 8)}px`;
    } else {
      form.style.top = `${y + SIZE + 12}px`;
      form.style.maxHeight = `${Math.max(200, H - (y + SIZE + 12) - 8)}px`;
    }
    form.style.setProperty("--ox", right ? "100%" : "0%");
    form.style.setProperty("--oy", below ? "100%" : "0%");
  }

  private nextId(): string {
    const max = Math.max(0, ...this.items.map((i) => (i.id ? Number(i.id) : 0)));
    return String(max + 1).padStart(3, "0");
  }

  private updatePath() {
    const t = this.$<HTMLInputElement>("input[name=title]").value.trim();
    const folder = this.config?.folders.open ?? "open";
    this.$(".form footer .path").textContent = `→ ${this.dir}/${folder}/${this.nextId()}-${t ? slugify(t) : "untitled"}.md`;
  }

  private renderToggles() {
    const toggles = this.toggles(this.type);
    for (const row of this.$$(".tog")) {
      const key = row.dataset.k as ContextKey;
      const sw = row.querySelector<HTMLButtonElement>(".sw")!;
      const disabled = key === "element" && this.type !== "bug";
      row.classList.toggle("disabled", disabled);
      sw.disabled = disabled;
      sw.setAttribute("aria-checked", String(!disabled && toggles[key]));
      const d = row.querySelector<HTMLElement>(".d")!;
      d.classList.remove("err");
      if (key === "screenshot") {
        const thumb = row.querySelector<HTMLElement>(".thumb")!;
        if (this.shot.state === "busy") {
          d.textContent = "taking it…";
          thumb.innerHTML = `<span class="spin"></span>`;
        } else if (this.shot.state === "done") {
          d.textContent = `taken when the form opened · ${window.innerWidth}×${window.innerHeight}`;
          thumb.innerHTML = `<img alt="" src="${this.shot.dataUrl}">${this.boxHtml(this.type === "bug" && toggles.element ? this.picked?.rect : undefined)}`;
        } else if (this.shot.state === "error") {
          d.textContent = `could not capture this page (${this.shot.error}); it saves without one`;
          d.classList.add("err");
          thumb.innerHTML = "";
        } else {
          d.textContent = "taken when the form opens";
          thumb.innerHTML = "";
        }
        thumb.hidden = this.shot.state === "idle" || this.shot.state === "error";
      } else if (key === "page") {
        d.textContent = `${location.pathname}${location.search} · “${document.title || "untitled"}”`;
      } else if (key === "browser") {
        d.textContent = this.browser?.summary ?? "…";
      } else if (key === "console") {
        const entries = consoleEntries();
        d.textContent = entries.length ? `${entries.length} since page load · last: ${entries[entries.length - 1].message}` : "none since page load";
      } else if (key === "element") {
        row.querySelector<HTMLElement>(".pick")!.hidden = disabled;
        d.textContent = disabled ? "bugs only" : this.picked ? `${this.picked.html} · ${this.picked.selector}` : "none yet · press Pick";
        if (this.picked) d.title = this.picked.selector;
      }
    }
  }

  private boxHtml(rect?: { x: number; y: number; w: number; h: number } | null): string {
    if (!rect) return "";
    return `<span class="box" style="left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.w * 100}%;height:${rect.h * 100}%"></span>`;
  }

  private async save() {
    if (this.saving) return;
    const titleInput = this.$<HTMLInputElement>("input[name=title]");
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.classList.remove("invalid");
      void titleInput.offsetWidth;
      titleInput.classList.add("invalid");
      titleInput.focus();
      return;
    }
    this.saving = true;
    const button = this.$<HTMLButtonElement>("[data-act=save]");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const t = this.toggles(this.type);
      const context: Record<string, unknown> = {};
      let noShot = false;
      if (t.screenshot) {
        if (this.shot.state === "busy") await this.shot.promise;
        if (this.shot.state === "done") context.screenshot = this.shot.dataUrl;
        else noShot = true;
      }
      if (t.page) context.page = pageInfo();
      if (t.browser) {
        const b = this.browser ?? (await browserInfo());
        context.browser = { browser: b.browser, viewport: b.viewport, devicePixelRatio: b.devicePixelRatio, touch: b.touch };
      }
      if (t.console) context.console = consoleEntries().map(({ level, message, source }) => ({ level, message, source }));
      if (this.type === "bug" && t.element && this.picked) context.element = this.picked;
      const { item } = await this.api<{ item: Item }>("/api/items", {
        method: "POST",
        json: { type: this.type, title, description: this.$<HTMLTextAreaElement>("textarea[name=desc]").value, priority: this.priority, context },
      });
      this.hideForm();
      this.resetDraft();
      this.toast(noShot ? "Saved without a screenshot" : "Saved", item.path, noShot);
      await this.refresh();
    } catch (error) {
      this.toast(`Not saved: ${(error as Error).message}`, undefined, true);
    } finally {
      this.saving = false;
      button.disabled = false;
      button.textContent = "Save";
    }
  }

  // ------------------------------------------------------------------ element picker

  private startPick() {
    if (this.type !== "bug") return;
    this.picking = true;
    this.$(".form").classList.add("away");
    this.$(".veil").classList.add("show");
  }

  private endPick() {
    if (!this.picking) return;
    this.picking = false;
    this.$(".form").classList.remove("away");
    this.$(".veil").classList.remove("show");
    this.$(".pickbox").style.display = "none";
    this.$(".picklabel").style.display = "none";
  }

  private elementAt(x: number, y: number): Element | null {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === this.host || el === document.documentElement || el === document.body) continue;
      return el;
    }
    return null;
  }

  private pickMove(e: MouseEvent) {
    const el = this.elementAt(e.clientX, e.clientY);
    const box = this.$(".pickbox");
    const label = this.$(".picklabel");
    if (!el) {
      box.style.display = label.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    label.textContent = `${selectorFor(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    Object.assign(label.style, { display: "block", left: `${Math.max(4, r.left)}px`, top: `${r.top > 30 ? r.top - 26 : r.bottom + 6}px` });
  }

  private pickClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = this.elementAt(e.clientX, e.clientY);
    if (el) {
      this.picked = describeElement(el);
      const toggles = this.toggles("bug");
      if (!toggles.element) {
        const saved = store<Record<string, Toggles>>("toggles") ?? {};
        saved.bug = { ...toggles, element: true };
        store("toggles", saved);
      }
    }
    this.endPick();
    this.renderToggles();
  }

  // ------------------------------------------------------------------ the board

  private openBoard() {
    if (!this.connected) {
      this.toast(OFFLINE, undefined, true);
      this.retrySoon();
      return;
    }
    this.setOpen(false);
    if (this.formOpen) this.hideForm();
    this.boardOpen = true;
    this.renderBoard();
    this.$(".board").classList.add("show");
    void this.refresh();
  }

  private closeBoard() {
    this.boardOpen = false;
    this.closeDrawer();
    this.$(".board").classList.remove("show");
  }

  private renderBoard() {
    const cols = this.$(".cols");
    cols.innerHTML = "";
    for (const status of STATUSES) {
      const list = this.items
        .filter((i) => i.status === status && (this.filter === "all" || i.type === this.filter))
        .sort((a, b) => (b.id ? Number(b.id) : 0) - (a.id ? Number(a.id) : 0));
      const col = document.createElement("div");
      col.className = "col";
      col.dataset.status = status;
      col.innerHTML = `<h3>${STATUS_LABELS[status]}<span>${list.length}</span></h3><div class="list"></div>`;
      const ul = col.querySelector(".list")!;
      if (!list.length) ul.innerHTML = `<div class="empty">Drop a card here</div>`;
      for (const it of list) {
        const card = document.createElement("article");
        card.className = `card${this.drawer?.key === it.key ? " selected" : ""}`;
        card.draggable = true;
        card.tabIndex = 0;
        card.dataset.key = it.key;
        card.style.setProperty("--tc", TYPE_COLOR[it.type]);
        card.innerHTML = `<div class="top"><span class="type"><i></i>${it.type}</span><span class="id">${it.id ? `#${esc(it.id)}` : esc(it.key)}</span></div><div class="title">${esc(it.title)}</div><div class="meta">${it.screenshot ? '<span class="shot" title="Has a screenshot"></span>' : ""}<span class="pg">${esc(it.page ?? "")}</span><span class="pr ${it.priority}">${it.priority}</span></div>`;
        card.addEventListener("click", () => void this.openDrawer(it.key));
        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter") void this.openDrawer(it.key);
        });
        card.addEventListener("dragstart", (e) => {
          e.dataTransfer!.setData(`application/x-${NAME}`, it.key);
          e.dataTransfer!.effectAllowed = "move";
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        ul.appendChild(card);
      }
      col.addEventListener("dragover", (e) => {
        if (!e.dataTransfer?.types.includes(`application/x-${NAME}`)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        col.classList.add("over");
      });
      col.addEventListener("dragleave", (e) => {
        if (!col.contains(e.relatedTarget as Node)) col.classList.remove("over");
      });
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        col.classList.remove("over");
        const key = e.dataTransfer?.getData(`application/x-${NAME}`);
        if (key) void this.move(key, status);
      });
      cols.appendChild(col);
    }
  }

  private async move(key: string, status: Status) {
    const item = this.items.find((i) => i.key === key);
    if (!item || item.status === status) return;
    const from = item.status;
    item.status = status; // optimistic
    this.updateBadge();
    this.renderBoard();
    try {
      const { item: moved } = await this.api<{ item: Item }>(`/api/items/${encodeURIComponent(key)}/move`, { method: "POST", json: { status } });
      this.toast("Moved", `${this.dir}/${this.config?.folders[from] ?? from}/ → ${moved.path}`);
      if (this.drawer?.key === key) void this.openDrawer(key, true);
    } catch (error) {
      item.status = from;
      this.updateBadge();
      this.renderBoard();
      this.toast(`Not moved: ${(error as Error).message}`, undefined, true);
    }
  }

  private async openDrawer(key: string, quiet = false) {
    try {
      const { item } = await this.api<{ item: FullItem }>(`/api/items/${encodeURIComponent(key)}`);
      this.editing = this.editing && this.drawer?.key === key;
      if (!this.editing) this.renderDrawer(item);
      this.drawer = item;
      this.$$(".card").forEach((c) => c.classList.toggle("selected", c.dataset.key === key));
    } catch (error) {
      if (!quiet) this.toast((error as Error).message, undefined, true);
    }
  }

  private closeDrawer() {
    this.drawer = null;
    this.editing = false;
    this.$(".drawer").classList.remove("show");
    this.$$(".card.selected").forEach((c) => c.classList.remove("selected"));
  }

  private assetUrl(src: string): string | null {
    const assets = this.config?.assets ?? "assets";
    const m = src.match(new RegExp(`^(?:\\.{1,2}/)*${assets.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([A-Za-z0-9][A-Za-z0-9._-]*)$`));
    if (m) return this.withKey(`${this.server}/assets/${encodeURIComponent(m[1])}`);
    if (/^https?:\/\//i.test(src)) return src;
    return null;
  }

  private renderDrawer(item: FullItem) {
    const drawer = this.$(".drawer");
    this.$(".drawer .file").textContent = item.path;
    this.$(".drawer .acts").innerHTML = this.editing
      ? `<button class="btn" data-act="cancel-edit">Cancel</button><button class="btn primary" data-act="save-edit">Save</button>`
      : `<button class="btn" data-act="edit">Edit</button><button class="btn danger" data-act="delete">Delete</button>`;
    const md = this.$(".drawer .md");
    const raw = this.$<HTMLTextAreaElement>(".drawer .raw");
    md.hidden = this.editing;
    raw.hidden = !this.editing;
    if (!this.editing) {
      const fmBlock = item.markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
      const fm = fmBlock
        ? `<pre class="fm">---\n${fmBlock[1]
            .split(/\r?\n/)
            .map((line) => {
              const m = line.match(/^([\w-]+):(.*)$/);
              return m ? `<b>${esc(m[1])}</b>:${esc(m[2])}` : esc(line);
            })
            .join("\n")}\n---</pre>`
        : "";
      const shotUrl = item.screenshot ? this.assetUrl(item.screenshot) : null;
      const html = `${fm}<h1>${esc(item.title)}</h1>${renderMarkdown(item.body, { image: (src) => this.assetUrl(src) })}`;
      md.innerHTML = html;
      // The screenshot, with the selected element outlined on it.
      const rect = Array.isArray(item.frontMatter.elementRect) ? (item.frontMatter.elementRect as number[]) : null;
      for (const img of md.querySelectorAll("img")) {
        if (!shotUrl || img.getAttribute("src") !== shotUrl) continue;
        const wrap = document.createElement("div");
        wrap.className = "shotbig";
        img.replaceWith(wrap);
        wrap.appendChild(img);
        if (rect && rect.length === 4) wrap.insertAdjacentHTML("beforeend", this.boxHtml({ x: rect[0], y: rect[1], w: rect[2], h: rect[3] }));
      }
      if (!item.hasFrontMatter && !fm) md.insertAdjacentHTML("afterbegin", `<p class="h">No front matter: shown by its file name.</p>`);
    } else {
      raw.value = item.markdown;
    }
    const move = this.$(".drawer .move");
    move.innerHTML = `<span>Move to</span>${STATUSES.map((s) => `<button data-s="${s}" ${s === item.status ? "disabled" : ""}>${STATUS_LABELS[s]}</button>`).join("")}`;
    move.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.addEventListener("click", () => void this.move(item.key, b.dataset.s as Status)));
    drawer.classList.add("show");
  }

  private startEdit() {
    if (!this.drawer) return;
    this.editing = true;
    this.renderDrawer(this.drawer);
    const raw = this.$<HTMLTextAreaElement>(".drawer .raw");
    raw.focus();
    raw.setSelectionRange(0, 0);
    raw.scrollTop = 0;
  }

  private async saveEdit() {
    if (!this.drawer) return;
    const markdown = this.$<HTMLTextAreaElement>(".drawer .raw").value;
    try {
      const { item } = await this.api<{ item: FullItem }>(`/api/items/${encodeURIComponent(this.drawer.key)}`, { method: "PUT", json: { markdown } });
      this.editing = false;
      this.drawer = item;
      this.renderDrawer(item);
      this.toast("Saved", item.path);
      await this.refresh();
    } catch (error) {
      this.toast(`Not saved: ${(error as Error).message}`, undefined, true);
    }
  }

  private async deleteItem(button: HTMLElement) {
    if (!this.drawer) return;
    if (!button.classList.contains("armed")) {
      button.classList.add("armed");
      button.textContent = "Delete the file?";
      clearTimeout(this.deleteArmed);
      this.deleteArmed = setTimeout(() => {
        button.classList.remove("armed");
        button.textContent = "Delete";
      }, 4000);
      return;
    }
    clearTimeout(this.deleteArmed);
    const { key, path } = this.drawer;
    try {
      await this.api(`/api/items/${encodeURIComponent(key)}`, { method: "DELETE" });
      this.closeDrawer();
      this.toast("Deleted", path);
      await this.refresh();
    } catch (error) {
      this.toast(`Not deleted: ${(error as Error).message}`, undefined, true);
    }
  }

  // ------------------------------------------------------------------ for window.__devbar

  handle(): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      name: NAME,
      version: VERSION,
      server: this.server,
      element: this.host,
      get connected() {
        return self.connected;
      },
      get items() {
        return self.items.slice();
      },
      newItem: (type: ItemType = "task") => self.openForm(["task", "bug", "idea"].includes(type) ? type : "task"),
      board: () => self.openBoard(),
      close: () => {
        self.endPick();
        self.closeBoard();
        if (self.formOpen) self.hideForm();
        self.setOpen(false);
      },
      reconnect: () => void self.connect(),
      unmount: () => {
        self.destroy();
        delete (window as unknown as Record<string, unknown>)[GLOBAL_NAME];
      },
    };
  }
}
