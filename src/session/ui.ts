/**
 * A feedback session on the page: a bar at the top, numbered pins where comments were left, a
 * popover to write or read one, and a dialog that downloads the whole session as one Markdown file.
 *
 * Pins: press C (or the bar's Comment button) and click a spot, or Alt/⌥-click anywhere. Each pin
 * remembers the element under it and where on that element it sits, so it follows the element as
 * the page scrolls and reflows; when the element is gone it stays at its spot in the page. Pins
 * show on the page (path and query) they were left on, and the session follows client-side route
 * changes as well as page loads.
 *
 * Every change goes through a SessionStore (the widget's localStorage, or the extension's service
 * worker); this class re-renders when the stored session changes, so all tabs show the same session.
 * What Finish does (download, or save to a backend) is the host's.
 */
import { describeElement, selectorFor } from "../client/context.js";
import { esc } from "../client/markdown.js";
import { localTimestamp } from "../item.js";
import { pageUrl, type Session, type SessionComment, type SessionConsoleEntry, type SessionStore } from "./model.js";

export interface SessionHost {
  /** The visible page as a PNG data URL without devbar's layers (`hide`), or null when it can't be taken. */
  capture(hide: HTMLElement[]): Promise<string | null>;
  /** The toolbar's element, which pins and picking must ignore. */
  toolbarHost(): HTMLElement | null;
  toast(text: string, code?: string, bad?: boolean): void;
  /** What Finish does, for the dialog: the button ("Download", "Save") and where it goes. */
  finishInfo(session: Session): { action: string; target: string; note: string };
  /** Finish: download the session or send it to the backend. Throws when it didn't work. */
  finish(session: Session, title: string, notes: string): Promise<void>;
  /** The session ended (finished, discarded, or ended in another tab). */
  ended(): void;
}

interface Draft {
  n: number;
  url: string;
  x: number;
  y: number;
  docX: number;
  docY: number;
  element: SessionComment["element"];
  anchor: SessionComment["anchor"];
  shot: string | null;
}

const PIN = "#ff3b5c";
const MAX_SIDE = 1600;

const CSS = `
.root{all:initial;--glass:rgba(10,10,11,.86);--ink:#fafafa;--muted:#8e8e95;--line:rgba(255,255,255,.1);--line2:rgba(255,255,255,.18);--pin:${PIN};
  --font:"devbar Geist","Geist",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mono:"devbar Geist Mono","Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --shadow:0 20px 50px rgba(0,0,0,.35),0 0 0 1px rgba(0,0,0,.5);--spring:cubic-bezier(.34,1.45,.64,1);
  font-family:var(--font);font-size:13.5px;line-height:1.4;color:var(--ink);color-scheme:dark;-webkit-font-smoothing:antialiased;visibility:visible}
.root *{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}
kbd{font:10.5px var(--mono);color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:0 5px;line-height:16px;margin-left:6px}
.glass{background:var(--glass);backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5);border:1px solid var(--line);box-shadow:var(--shadow)}
[hidden]{display:none!important}

.bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px;height:42px;padding:0 5px 0 14px;border-radius:999px;z-index:5;white-space:nowrap;animation:drop .45s var(--spring)}
@keyframes drop{from{opacity:0;transform:translate(-50%,-14px)}}
.live{width:8px;height:8px;border-radius:50%;background:var(--pin);box-shadow:0 0 0 3px rgba(255,59,92,.2);flex:none}
.name{font-weight:500;margin-left:4px}
.count{color:var(--muted);font:12px var(--mono);margin:0 6px 0 4px}
.b{height:32px;padding:0 12px;border-radius:999px;white-space:nowrap;font-weight:500;font-size:13px;display:inline-flex;align-items:center;transition:background .15s}
.b:hover{background:rgba(255,255,255,.08)}
.b.primary{background:#fff;color:#0a0a0b}.b.primary:hover{background:#e7e7ea}
.b.primary kbd{color:#55555c;border-color:rgba(0,0,0,.15)}
.b.icon{width:32px;padding:0;justify-content:center;font-size:18px;color:var(--muted)}
.b.armed{background:rgba(255,59,92,.18);color:#ff8fa3}
.b:disabled{opacity:.45;cursor:default}

.pins{position:fixed;inset:0;pointer-events:none;z-index:1}
.pin{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:var(--pin);color:#fff;font:600 12px/26px var(--font);text-align:center;
  border:2px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:auto;transition:transform .2s var(--spring);will-change:transform}
.pin:hover,.pin.on{z-index:2;filter:brightness(1.08)}
.pin.draft{animation:pulse 1.4s ease-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,59,92,.55),0 4px 14px rgba(0,0,0,.35)}100%{box-shadow:0 0 0 14px rgba(255,59,92,0),0 4px 14px rgba(0,0,0,.35)}}

.veil{position:fixed;inset:0;cursor:crosshair;z-index:3;background:transparent}
.hl{position:fixed;border:2px solid var(--pin);background:rgba(255,59,92,.08);border-radius:4px;pointer-events:none;z-index:2;transition:all .08s}
.hint{position:fixed;left:50%;top:64px;transform:translateX(-50%);white-space:nowrap;padding:8px 14px;border-radius:999px;font-size:13px;z-index:4;pointer-events:none}

.pop{position:fixed;width:320px;border-radius:14px;z-index:6;overflow:hidden;animation:pop .3s var(--spring)}
@keyframes pop{from{opacity:0;transform:scale(.94)}}
.ph{display:flex;align-items:center;gap:8px;padding:10px 12px 0;font-size:12px;color:var(--muted)}
.ph b{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--pin);color:#fff;font:600 11px var(--font)}
.ph span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}
.pop textarea{display:block;width:calc(100% - 24px);margin:10px 12px 0;min-height:88px;max-height:240px;resize:vertical;background:#161618;border:1px solid var(--line);border-radius:10px;color:var(--ink);
  font:13.5px/1.45 var(--font);padding:9px 10px;outline:none}
.pop textarea:focus{border-color:var(--line2)}
.pop textarea.invalid{border-color:var(--pin);animation:shake .3s}
@keyframes shake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.pop .text{margin:10px 12px 0;white-space:pre-wrap;word-wrap:break-word;max-height:240px;overflow:auto}
.pop .el{margin:8px 12px 0;font:11.5px var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf{display:flex;justify-content:flex-end;gap:6px;padding:10px 10px 10px}
.pf .sp{flex:1}
.b.danger{color:#ff8fa3}

.scrim{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:7;animation:fade .2s}
@keyframes fade{from{opacity:0}}
.finish{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 32px));border-radius:16px;z-index:8;padding:16px;animation:pop .3s var(--spring)}
.finish h3{margin:0 0 4px;font-size:15px;font-weight:600}
.finish p{margin:0 0 12px;color:var(--muted);font-size:12.5px}
.finish label{display:block;font-size:12px;color:var(--muted);margin:10px 0 5px}
.finish input,.finish textarea{display:block;width:100%;background:#161618;border:1px solid var(--line);border-radius:10px;color:var(--ink);font:13.5px/1.45 var(--font);padding:8px 10px;outline:none}
.finish textarea{min-height:80px;resize:vertical}
.finish input:focus,.finish textarea:focus{border-color:var(--line2)}
.finish .pf{padding:14px 0 0}
.finish .file{font:11.5px var(--mono);color:var(--muted);align-self:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

const TEMPLATE = `
<div class="root">
  <div class="pins"></div>
  <div class="hl" hidden></div>
  <div class="veil" hidden></div>
  <div class="hint glass" hidden>Click where your comment goes · <kbd>Esc</kbd> cancels</div>
  <div class="bar glass" role="toolbar" aria-label="Feedback session">
    <span class="live" aria-hidden="true"></span><span class="name">Feedback session</span><span class="count"></span>
    <button class="b primary" data-act="arm" title="Pin a comment (C, or Alt/⌥-click anywhere)">+ Comment<kbd>C</kbd></button>
    <button class="b" data-act="finish">Finish</button>
    <button class="b icon" data-act="discard" title="Discard the session" aria-label="Discard the session">×</button>
  </div>
  <div class="pop glass" role="dialog" aria-label="Comment" hidden></div>
  <div class="scrim" hidden></div>
  <div class="finish glass" role="dialog" aria-label="Finish the session" hidden>
    <h3>Download the session</h3>
    <p class="sum"></p>
    <label>Title<input name="title" autocomplete="off"></label>
    <label>Notes for the whole session (optional)<textarea name="notes" placeholder="Context, priorities, anything that applies to every comment (Markdown)"></textarea></label>
    <div class="pf"><span class="file"></span><span class="sp"></span><button class="b" data-act="finish-back">Keep going</button><button class="b primary" data-act="download">Download</button></div>
  </div>
</div>`;

export class SessionUI {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private session: Session;
  private url = pageUrl();
  private armed = false;
  private draft: Draft | null = null;
  /** The comment whose popover is open, or "draft". */
  private open: string | null = null;
  private editing = false;
  private placing = false;
  private frame = 0;
  private readonly elements = new Map<string, Element | null>();
  private readonly cleanups: Array<() => void> = [];
  private pendingConsole: SessionConsoleEntry[] = [];
  private consoleTimer: ReturnType<typeof setTimeout> | undefined;
  private discardTimer: ReturnType<typeof setTimeout> | undefined;
  private deleteTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    session: Session,
    private readonly store: SessionStore,
    private readonly app: SessionHost,
  ) {
    this.session = session;
    this.host = document.createElement("devbar-session");
    this.host.setAttribute(
      "style",
      ["all:initial", "position:fixed", "left:0", "top:0", "width:0", "height:0", "display:block", "overflow:visible", "visibility:visible", "opacity:1", "z-index:2147483590"].map((d) => `${d} !important`).join(";"),
    );
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${CSS}</style>${TEMPLATE}`;
    this.bind();
  }

  // ------------------------------------------------------------------ lifecycle

  mount(): void {
    document.body.appendChild(this.host);
    const observer = new MutationObserver(() => {
      if (!this.host.isConnected && document.body) document.body.appendChild(this.host);
    });
    observer.observe(document.body, { childList: true });
    this.cleanups.push(() => observer.disconnect());
    this.render();
    void this.store.apply({ type: "session:visit", page: { url: this.url, title: document.title } });
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn());
    cancelAnimationFrame(this.frame);
    clearTimeout(this.consoleTimer);
    this.host.remove();
  }

  /** The stored session changed (here or in another tab). */
  update(session: Session): void {
    this.session = session;
    if (this.open && this.open !== "draft" && !session.comments.some((c) => c.id === this.open)) this.closePop();
    this.render();
  }

  get busy(): boolean {
    return !!this.draft || this.armed;
  }

  // ------------------------------------------------------------------ helpers

  private $<T extends Element = HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  private listen<E extends Event>(target: Window | Document, type: string, fn: (e: E) => void, options: AddEventListenerOptions | boolean = true) {
    target.addEventListener(type, fn as EventListener, options);
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, options));
  }

  private ours(e: Event): boolean {
    const path = e.composedPath();
    const toolbar = this.app.toolbarHost();
    return path.includes(this.host) || (!!toolbar && path.includes(toolbar));
  }

  /** The page's element at a point, looking through devbar's own layers. */
  private elementAt(x: number, y: number): Element | null {
    const toolbar = this.app.toolbarHost();
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === this.host || el === toolbar) continue;
      if (el === document.documentElement || el === document.body) return null;
      return el;
    }
    return null;
  }

  // ------------------------------------------------------------------ events

  private bind() {
    this.root.addEventListener("click", (e) => {
      const target = (e.target as Element).closest<HTMLElement>("[data-act]");
      const pin = (e.target as Element).closest<HTMLElement>(".pin");
      if (pin && !target) return this.openComment(pin.dataset.id!);
      if (!target) return;
      switch (target.dataset.act) {
        case "arm":
          return this.armed ? this.disarm() : this.arm();
        case "finish":
          return this.openFinish();
        case "finish-back":
          return this.closeFinish();
        case "download":
          return void this.download(target as HTMLButtonElement);
        case "discard":
          return void this.discard(target);
        case "pop-save":
          return void this.saveDraft();
        case "pop-cancel":
          return this.cancelDraft();
        case "pop-close":
          return this.closePop();
        case "pop-edit":
          this.editing = true;
          return this.renderPop();
        case "pop-update":
          return void this.saveEdit();
        case "pop-delete":
          return void this.deleteComment(target);
      }
    });
    this.$(".scrim").addEventListener("click", () => this.closeFinish());

    const veil = this.$(".veil");
    veil.addEventListener("mousemove", (e) => this.highlight(this.elementAt(e.clientX, e.clientY)));
    veil.addEventListener("click", (e) => {
      e.preventDefault();
      this.disarm();
      void this.place(e.clientX, e.clientY);
    });

    // Alt/⌥-click anywhere drops a pin; the page never sees the click.
    const altBlock = (e: MouseEvent) => {
      if (!e.altKey || e.button !== 0 || this.ours(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "click") void this.place(e.clientX, e.clientY);
    };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) this.listen<MouseEvent>(window, type, altBlock);

    this.listen<KeyboardEvent>(window, "keydown", (e) => this.onKey(e));
    const schedule = () => this.schedule();
    this.listen(window, "scroll", schedule, { capture: true, passive: true });
    this.listen(window, "resize", schedule);
    // Layout shifts and client-side route changes: check a few times a second.
    const tick = setInterval(() => {
      if (pageUrl() !== this.url) this.routeChanged();
      this.schedule();
    }, 400);
    this.cleanups.push(() => clearInterval(tick));
  }

  private onKey(e: KeyboardEvent) {
    if (e.defaultPrevented) return; // the toolbar handled it
    const path = e.composedPath();
    const target = path[0] as HTMLElement | undefined;
    const typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
    const inside = path.includes(this.host);
    if (e.key === "Escape") {
      if (this.armed) this.disarm();
      else if (!this.$(".finish").hidden) this.closeFinish();
      else if (this.open === "draft") this.cancelDraft();
      else if (this.open) this.closePop();
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (inside && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!this.$(".finish").hidden) void this.download(this.$<HTMLButtonElement>("[data-act=download]"));
      else if (this.open === "draft") void this.saveDraft();
      else if (this.editing) void this.saveEdit();
      return;
    }
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "c" && !this.draft && this.$(".finish").hidden) {
      e.preventDefault();
      e.stopPropagation();
      this.arm();
    }
  }

  private routeChanged() {
    this.url = pageUrl();
    this.elements.clear();
    if (this.open && this.open !== "draft") this.closePop();
    void this.store.apply({ type: "session:visit", page: { url: this.url, title: document.title } });
    // The title often changes a moment after a client-side route change.
    setTimeout(() => void this.store.apply({ type: "session:visit", page: { url: this.url, title: document.title } }), 1200);
  }

  /** Console entries from the page, kept per page in the session. */
  noteConsole(entry: SessionConsoleEntry): void {
    this.pendingConsole.push(entry);
    clearTimeout(this.consoleTimer);
    const url = this.url;
    this.consoleTimer = setTimeout(() => {
      const entries = this.pendingConsole.splice(0);
      void this.store.apply({ type: "session:console", url, entries });
    }, 800);
  }

  // ------------------------------------------------------------------ placing a pin

  arm(): void {
    if (this.placing) return;
    if (this.draft) return this.focusPop();
    this.closePop();
    this.armed = true;
    this.$(".veil").hidden = false;
    this.$(".hint").hidden = false;
    this.$("[data-act=arm]").classList.add("armed");
  }

  private disarm() {
    this.armed = false;
    this.$(".veil").hidden = true;
    this.$(".hint").hidden = true;
    this.$(".hl").hidden = true;
    this.$("[data-act=arm]").classList.remove("armed");
  }

  private highlight(el: Element | null) {
    const hl = this.$(".hl");
    if (!el) {
      hl.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(hl.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
    hl.hidden = false;
  }

  private async place(x: number, y: number) {
    if (this.placing) return;
    if (this.draft) this.cancelDraft();
    this.closePop();
    this.placing = true;
    try {
      const el = this.elementAt(x, y);
      const rect = el?.getBoundingClientRect() ?? null;
      const n = this.session.nextN;
      let anchor: Draft["anchor"] = null;
      let element: Draft["element"] = null;
      if (el && rect && rect.width > 0 && rect.height > 0) {
        anchor = { selector: selectorFor(el), fx: round((x - rect.left) / rect.width), fy: round((y - rect.top) / rect.height) };
        element = describeElement(el);
      }
      const raw = await this.app.capture([this.host, this.app.toolbarHost()].filter((h): h is HTMLElement => !!h));
      const shot = raw ? await markScreenshot(raw, x, y, n, rect).catch(() => null) : null;
      this.draft = { n, url: this.url, x, y, docX: x + scrollX, docY: y + scrollY, element, anchor, shot };
      this.open = "draft";
      this.editing = true;
      this.render();
      this.renderPop();
    } finally {
      this.placing = false;
    }
  }

  private async saveDraft() {
    const draft = this.draft;
    if (!draft) return;
    const textarea = this.$<HTMLTextAreaElement>(".pop textarea");
    const text = textarea.value.trim();
    if (!text) {
      textarea.classList.remove("invalid");
      void textarea.offsetWidth;
      textarea.classList.add("invalid");
      textarea.focus();
      return;
    }
    const button = this.$<HTMLButtonElement>("[data-act=pop-save]");
    button.disabled = true;
    const reply = await this.store.apply({
      type: "session:comment",
      comment: {
        n: draft.n,
        url: draft.url,
        pageTitle: document.title,
        text,
        created: localTimestamp(),
        element: draft.element,
        anchor: draft.anchor,
        point: { x: draft.docX, y: draft.docY },
        viewport: `${innerWidth}x${innerHeight}`,
      },
      screenshot: draft.shot,
    }).catch((error: Error) => ({ ok: false, error: error.message }) as { ok: boolean; error?: string; session?: Session });
    if (!reply.ok) {
      button.disabled = false;
      this.app.toast(`Not saved: ${reply.error ?? "unknown error"}`, undefined, true);
      return;
    }
    this.draft = null;
    this.closePop();
    if (reply.session) this.update(reply.session);
  }

  private cancelDraft() {
    this.draft = null;
    this.closePop();
    this.render();
  }

  // ------------------------------------------------------------------ the popover

  private openComment(id: string) {
    if (this.draft) this.cancelDraft();
    this.open = id;
    this.editing = false;
    this.renderPop();
    this.render();
  }

  private closePop() {
    if (this.open === "draft") this.draft = null;
    this.open = null;
    this.editing = false;
    this.$(".pop").hidden = true;
    this.render();
  }

  private focusPop() {
    this.$<HTMLTextAreaElement>(".pop textarea")?.focus();
  }

  private renderPop() {
    const pop = this.$(".pop");
    const draft = this.open === "draft" ? this.draft : null;
    const comment = draft ? null : this.session.comments.find((c) => c.id === this.open);
    if (!draft && !comment) {
      pop.hidden = true;
      return;
    }
    const n = draft ? draft.n : comment!.n;
    const element = draft ? draft.element : comment!.element;
    const where = element ? `${element.html} · ${element.selector}` : "a spot on the page";
    const head = `<div class="ph"><b>${n}</b><span>${esc(location.pathname + location.search)}</span></div>`;
    if (this.editing) {
      const text = draft ? "" : comment!.text;
      pop.innerHTML = `${head}<textarea placeholder="What should change here? (Markdown)">${esc(text)}</textarea><div class="el" title="${esc(where)}">${esc(where)}</div>
        <div class="pf">${draft ? `<button class="b" data-act="pop-cancel">Cancel</button><button class="b primary" data-act="pop-save">Save</button>` : `<button class="b" data-act="pop-close">Cancel</button><button class="b primary" data-act="pop-update">Save</button>`}</div>`;
    } else {
      pop.innerHTML = `${head}<div class="text">${esc(comment!.text)}</div><div class="el" title="${esc(where)}">${esc(where)}</div>
        <div class="pf"><button class="b danger" data-act="pop-delete">Delete</button><span class="sp"></span><button class="b" data-act="pop-edit">Edit</button><button class="b" data-act="pop-close">Close</button></div>`;
    }
    pop.hidden = false;
    this.placePop();
    if (this.editing) setTimeout(() => this.focusPop(), 30);
  }

  private placePop() {
    const pop = this.$(".pop");
    if (pop.hidden) return;
    const at = this.open === "draft" && this.draft ? { x: this.draft.x, y: this.draft.y } : this.pinPosition(this.session.comments.find((c) => c.id === this.open));
    if (!at) return;
    const w = pop.offsetWidth || 320;
    const h = pop.offsetHeight || 200;
    let left = at.x + 22;
    if (left + w > innerWidth - 12) left = at.x - 22 - w;
    left = Math.min(Math.max(12, left), innerWidth - w - 12);
    const top = Math.min(Math.max(12, at.y - 20), innerHeight - h - 12);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  private async saveEdit() {
    const id = this.open;
    if (!id || id === "draft") return;
    const text = this.$<HTMLTextAreaElement>(".pop textarea").value.trim();
    if (!text) return;
    const reply = await this.store.apply({ type: "session:edit", id, text });
    if (!reply.ok) return this.app.toast(`Not saved: ${reply.error}`, undefined, true);
    this.editing = false;
    if (reply.session) this.update(reply.session);
    this.renderPop();
  }

  private async deleteComment(button: HTMLElement) {
    const id = this.open;
    if (!id || id === "draft") return;
    if (!button.classList.contains("armed")) {
      button.classList.add("armed");
      button.textContent = "Delete it?";
      clearTimeout(this.deleteTimer);
      this.deleteTimer = setTimeout(() => {
        button.classList.remove("armed");
        button.textContent = "Delete";
      }, 3000);
      return;
    }
    const reply = await this.store.apply({ type: "session:delete", id });
    this.closePop();
    if (reply.session) this.update(reply.session);
  }

  // ------------------------------------------------------------------ pins and the bar

  /** Where a comment's pin is on screen now: on its element if it is still there. */
  private pinPosition(c: SessionComment | undefined): { x: number; y: number } | null {
    if (!c) return null;
    let el = this.elements.get(c.id);
    if (c.anchor && (!el || !el.isConnected)) {
      try {
        el = document.querySelector(c.anchor.selector);
      } catch {
        el = null;
      }
      this.elements.set(c.id, el ?? null);
    }
    if (el && c.anchor) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) return { x: r.left + c.anchor.fx * r.width, y: r.top + c.anchor.fy * r.height };
    }
    return { x: c.point.x - scrollX, y: c.point.y - scrollY };
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render() {
    const here = this.session.comments.filter((c) => c.url === this.url);
    const layer = this.$(".pins");
    const want = new Set(here.map((c) => c.id));
    if (this.draft && this.draft.url === this.url) want.add("draft");
    for (const pin of [...layer.children] as HTMLElement[]) if (!want.has(pin.dataset.id!)) pin.remove();
    const put = (id: string, n: number, at: { x: number; y: number } | null, title: string) => {
      let pin = layer.querySelector<HTMLElement>(`.pin[data-id="${id}"]`);
      if (!pin) {
        pin = document.createElement("button");
        pin.className = "pin";
        pin.dataset.id = id;
        layer.appendChild(pin);
      }
      if (pin.textContent !== String(n)) pin.textContent = String(n);
      pin.title = title;
      pin.classList.toggle("draft", id === "draft");
      pin.classList.toggle("on", this.open === id);
      pin.hidden = !at;
      if (at) pin.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px)`;
    };
    for (const c of here) put(c.id, c.n, this.pinPosition(c), c.text.split("\n")[0].slice(0, 120));
    if (this.draft && this.draft.url === this.url) put("draft", this.draft.n, { x: this.draft.docX - scrollX, y: this.draft.docY - scrollY }, "New comment");
    if (this.draft && this.open === "draft") Object.assign(this.draft, { x: this.draft.docX - scrollX, y: this.draft.docY - scrollY });

    const total = this.session.comments.length;
    const pages = new Set(this.session.comments.map((c) => c.url)).size;
    this.$(".count").textContent = total ? `${total} comment${total === 1 ? "" : "s"} · ${pages} page${pages === 1 ? "" : "s"}` : "no comments yet";
    this.placePop();
  }

  // ------------------------------------------------------------------ finishing

  private openFinish() {
    this.disarm();
    if (this.draft) this.cancelDraft();
    this.closePop();
    const s = this.session;
    const total = s.comments.length;
    const pages = new Set(s.comments.map((c) => c.url)).size;
    const info = this.app.finishInfo(s);
    this.$(".finish h3").textContent = `${info.action} the session`;
    this.$(".sum").textContent = total
      ? `${total} comment${total === 1 ? "" : "s"} on ${pages} page${pages === 1 ? "" : "s"}, ${info.note}`
      : "No comments yet. Press C, or Alt/⌥-click anywhere, to pin one.";
    const title = this.$<HTMLInputElement>(".finish input[name=title]");
    if (!title.value) title.value = `Feedback on ${location.host || "this site"}`;
    this.$(".finish .file").textContent = info.target;
    const button = this.$<HTMLButtonElement>("[data-act=download]");
    button.textContent = info.action;
    button.disabled = !total;
    this.$(".scrim").hidden = false;
    this.$(".finish").hidden = false;
    setTimeout(() => title.focus(), 30);
  }

  private closeFinish() {
    this.$(".scrim").hidden = true;
    this.$(".finish").hidden = true;
  }

  private async download(button: HTMLButtonElement) {
    const s = this.session;
    if (!s.comments.length || button.disabled) return;
    const label = button.textContent ?? "Download";
    button.disabled = true;
    button.textContent = label === "Download" ? "Preparing…" : "Saving…";
    try {
      const title = this.$<HTMLInputElement>(".finish input[name=title]").value.trim() || `Feedback on ${location.host}`;
      const notes = this.$<HTMLTextAreaElement>(".finish textarea[name=notes]").value;
      await this.app.finish(s, title, notes);
      await this.store.apply({ type: "session:end" });
      this.app.ended();
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      this.app.toast(`Not ${label === "Download" ? "downloaded" : "saved"}: ${(error as Error).message}`, undefined, true);
    }
  }

  private async discard(button: HTMLElement) {
    if (!this.session.comments.length || button.classList.contains("armed")) {
      await this.store.apply({ type: "session:end" });
      this.app.toast(this.session.comments.length ? "Session discarded. Nothing was saved." : "Session ended.");
      this.app.ended();
      return;
    }
    button.classList.add("armed");
    button.textContent = "Discard all?";
    button.style.width = "auto";
    button.style.padding = "0 12px";
    button.style.fontSize = "13px";
    clearTimeout(this.discardTimer);
    this.discardTimer = setTimeout(() => {
      button.classList.remove("armed");
      button.textContent = "×";
      button.removeAttribute("style");
    }, 3500);
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/** The tab's capture with the pin's number at its spot and the element under it outlined. */
async function markScreenshot(dataUrl: string, x: number, y: number, n: number, rect: DOMRect | null): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const k = img.naturalWidth / innerWidth; // device pixels per CSS pixel in the capture
  const fit = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * fit);
  canvas.height = Math.round(img.naturalHeight * fit);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const s = k * fit; // CSS pixels to output pixels
  if (rect && rect.width > 0 && rect.height > 0) {
    ctx.strokeStyle = PIN;
    ctx.lineWidth = Math.max(2, 2 * s);
    ctx.setLineDash([6 * s, 4 * s]);
    ctx.strokeRect(rect.left * s, rect.top * s, rect.width * s, rect.height * s);
    ctx.setLineDash([]);
  }
  const r = 13 * Math.max(s, 1);
  const cx = x * s;
  const cy = y * s;
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 8 * s;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = PIN;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2 * Math.max(s, 1);
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${Math.round(12 * Math.max(s, 1))}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), cx, cy + 0.5);
  return canvas.toDataURL("image/png");
}
