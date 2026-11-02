const CSS_URL = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap";

let started = false;

/**
 * Geist and Geist Mono for the toolbar. A shadow root cannot declare @font-face, and a global
 * stylesheet would touch the host page, so the faces are added through the FontFace API under
 * names of their own ("devbar Geist"): nothing the page styles can pick them up by accident.
 * Faces load lazily, only for the characters the toolbar draws. Offline, the system font is used.
 */
export function loadFonts(prefix: string): void {
  if (started || typeof FontFace === "undefined" || !document.fonts) return;
  started = true;
  fetch(CSS_URL)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((css) => {
      for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
        const family = block.match(/font-family:\s*['"]?([^;'"]+)['"]?;/)?.[1];
        const src = block.match(/src:\s*([^;]+);/)?.[1];
        if (!family || !src) continue;
        const descriptors: FontFaceDescriptors = { display: "swap" };
        const weight = block.match(/font-weight:\s*([^;]+);/)?.[1];
        const style = block.match(/font-style:\s*([^;]+);/)?.[1];
        const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];
        if (weight) descriptors.weight = weight.trim();
        if (style) descriptors.style = style.trim();
        if (range) descriptors.unicodeRange = range.trim();
        document.fonts.add(new FontFace(`${prefix} ${family.trim()}`, src.trim(), descriptors));
      }
    })
    .catch(() => undefined);
}
