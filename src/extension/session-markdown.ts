/**
 * A feedback session as one Markdown file: front matter, the notes, then a section per page with
 * its comments in order and the console errors seen there. Written to be read by people and by AI
 * coding agents alike.
 */
import { inlineCode, oneLine, yamlScalar } from "../item.js";
import type { Session, SessionComment } from "./shared.js";

export interface SessionMarkdownOptions {
  title: string;
  notes: string;
  finished: string;
  /** Screenshot path per comment id, relative to the Markdown file, e.g. `assets/x-01.png`. */
  screenshots: Map<string, string>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The page's path and query, for headings; the full URL is written under them. */
function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/**
 * `### 3. Save should be disabled…` and the text under it. The heading is the comment's first line;
 * a one-line comment that fits is not repeated below it.
 */
function commentBlock(c: SessionComment): string[] {
  const text = c.text.replace(/\r\n/g, "\n").trim();
  const lines = text.split("\n");
  const first = lines[0].trim();
  const plain = first.replace(/[#*_`>[\]]/g, "").trim();
  const label = oneLine(plain, 80) || "(no text)";
  const rest = lines.slice(1).join("\n").trim();
  const whole = label === first;
  return [`### ${c.n}. ${label}`, ...(whole ? (rest ? [rest] : []) : [text])];
}

export function buildSessionMarkdown(session: Session, o: SessionMarkdownOptions): string {
  const comments = [...session.comments].sort((a, b) => a.n - b.n);
  // Pages in the order they were first visited, only those with comments.
  const pages = session.pages.filter((p) => comments.some((c) => c.url === p.url)).map((p) => ({ ...p }));
  for (const c of comments) if (!pages.some((p) => p.url === c.url)) pages.push({ url: c.url, title: c.pageTitle, console: [] });
  // Name each page as it was titled when the first comment on it was left.
  for (const p of pages) p.title = comments.find((c) => c.url === p.url && c.pageTitle)?.pageTitle ?? p.title;
  const origins = [...new Set(pages.map((p) => { try { return new URL(p.url).origin; } catch { return p.url; } }))];
  const viewports = [...new Set(comments.map((c) => c.viewport).filter(Boolean))];

  const fm: Array<[string, unknown]> = [
    ["title", oneLine(o.title, 200)],
    ["type", "feedback-session"],
    ["started", session.started],
    ["finished", o.finished],
    [origins.length === 1 ? "origin" : "origins", origins.length === 1 ? origins[0] : origins.join(", ")],
    ["pages", pages.length],
    ["comments", comments.length],
  ];
  if (session.browser) fm.push(["browser", session.browser]);
  if (viewports.length) fm.push(["viewport", viewports.join(", ")]);
  const yaml = fm.map(([k, v]) => `${k}: ${k === "started" || k === "finished" ? v : yamlScalar(v)}`);

  const out: string[] = [`---\n${yaml.join("\n")}\n---`, `# ${oneLine(o.title, 200)}`];
  const notes = o.notes.replace(/\r\n/g, "\n").trim();
  if (notes) out.push(notes);
  out.push(
    `${comments.length} comment${comments.length === 1 ? "" : "s"} on ${pages.length} page${pages.length === 1 ? "" : "s"}. ` +
      "Each comment is pinned to a spot on its page; its screenshot shows the pin's number there and outlines the element under it.",
  );
  if (pages.length > 1) {
    out.push(
      `## Pages\n${pages
        .map((p, i) => {
          const count = comments.filter((c) => c.url === p.url).length;
          return `${i + 1}. ${inlineCode(shortPath(p.url))}${p.title ? ` — ${oneLine(p.title, 120)}` : ""} (${count} comment${count === 1 ? "" : "s"})`;
        })
        .join("\n")}`,
    );
  }

  for (const page of pages) {
    out.push(`## ${inlineCode(shortPath(page.url))}${page.title ? ` — ${oneLine(page.title, 120)}` : ""}\n${page.url}`);
    for (const c of comments.filter((x) => x.url === page.url)) {
      const block = commentBlock(c);
      const facts: string[] = [];
      if (c.element) {
        const el = c.element;
        const html = oneLine(el.html || `<${el.tag ?? "element"}>`, 300);
        facts.push(`- **Element:** ${inlineCode(html)} — selector ${inlineCode(oneLine(el.selector, 300))}${el.text ? ` — text ${inlineCode(oneLine(el.text, 120))}` : ""}`);
      }
      facts.push(`- **Pinned at:** ${Math.round(c.point.x)}, ${Math.round(c.point.y)} px in the page${c.viewport ? `, window ${c.viewport}` : ""}`);
      block.push(facts.join("\n"));
      const shot = o.screenshots.get(c.id);
      if (shot) block.push(`![Comment ${c.n}](${shot})`);
      out.push(block.join("\n\n"));
    }
    if (page.console.length) {
      const lines = page.console.map((e) => {
        const message = oneLine(e.message, 400);
        const label = e.level === "error" ? "Error" : "Warning";
        const prefixed = /^(warning|error|uncaught|unhandled)\b/i.test(message) ? message : `${label}: ${message}`;
        return `- ${prefixed}${e.source ? ` (${oneLine(e.source, 120)})` : ""}`;
      });
      out.push(`### Console errors on this page\n${lines.join("\n")}`);
    }
  }
  return `${out.join("\n\n")}\n`;
}

/** `feedback-shop-example-com-2026-11-11-1504`: the download's name, without extension. */
export function sessionFileBase(session: Session, now = new Date()): string {
  let host = "page";
  const first = session.comments[0]?.url ?? session.pages[0]?.url;
  try {
    if (first) host = new URL(first).host;
  } catch {
    // keep "page"
  }
  const slug = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `feedback-${slug}-${stamp}`;
}

export const commentShotName = (base: string, n: number): string => `assets/${base}-${pad(n)}.png`;
