/** Just enough Markdown for an item's body: headings, paragraphs, lists, quotes, code, images, links. */

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface RenderOptions {
  /** Turns an image path in the file into a URL the board can load, or null to drop it. */
  image(src: string, alt: string): string | null;
}

function inline(text: string, o: RenderOptions): string {
  const codes: string[] = [];
  // Code spans first, so nothing inside them is touched.
  let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _f, code) => {
    codes.push(`<code>${esc(code.trim() === "" ? code : code.replace(/^ (.*) $/, "$1"))}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  const html: string[] = [];
  const keep = (h: string) => {
    html.push(h);
    return `\u0001${html.length - 1}\u0001`;
  };
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, src) => {
    const url = o.image(src, alt);
    return url ? keep(`<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`) : esc(alt);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) =>
    /^https?:\/\//i.test(href) ? keep(`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`) : m,
  );
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
  return s
    .replace(/\u0001(\d+)\u0001/g, (_, i) => html[Number(i)])
    .replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

export function renderMarkdown(src: string, o: RenderOptions): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(```+|~~~+)(.*)$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="code"><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      out.push(`<h${Math.min(h[1].length + 2, 6)} class="h">${inline(h[2], o)}</h${Math.min(h[1].length + 2, 6)}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(body.join("\n"), o)}</blockquote>`);
      continue;
    }
    const list = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        const task = item.match(/^\[([ xX])\]\s+(.*)$/);
        items.push(task ? `<li class="task"><input type="checkbox" disabled ${task[1] !== " " ? "checked" : ""}> ${inline(task[2], o)}</li>` : `<li>${inline(item, o)}</li>`);
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s+)/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    if (!para.length) para.push(lines[i++]); // never stall on a line no rule above took
    out.push(`<p>${para.map((p) => inline(p, o)).join("<br>")}</p>`);
  }
  return out.join("\n");
}
