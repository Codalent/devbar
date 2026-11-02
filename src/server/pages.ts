import { NAME } from "../name.js";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** `GET /`: what is running, the one line to add, and the widget itself so the board is usable here. */
export function landingPage(o: { serverUrl: string; project: string; dir: string; version: string }): string {
  const tag = `<script src="${o.serverUrl}/${NAME}.js"></script>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${NAME} · ${esc(o.project)}</title>
<script src="/${NAME}.js"></script>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f4f5;color:#18181b;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;padding:32px}
h1{font-size:22px;margin:0 0 6px}
p{color:#52525b;margin:0 0 14px}
code,pre{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:#0a0a0b;color:#fafafa;border-radius:10px;padding:12px 14px;overflow:auto;margin:0 0 16px}
a{color:#18181b}
</style></head>
<body><main>
<h1>${NAME} ${esc(o.version)} is running</h1>
<p>Project <b>${esc(o.project)}</b>, files in <code>${esc(o.dir)}/</code>. The dot in the corner of this page is the toolbar; its Board pill opens the board.</p>
<p>Add it to your app in development with one line:</p>
<pre>${esc(tag)}</pre>
<p>React and Next: <code>import { DevBar } from "${NAME}/react"</code> and render <code>&lt;DevBar /&gt;</code> once in the root layout.</p>
<p><a href="/demo">Open the demo page</a> · <a href="/demo?reset=1">the same with an aggressive global CSS reset</a></p>
</main></body></html>`;
}

/**
 * `GET /demo`: a small, realistic host app with the widget loaded from this server, to exercise the
 * whole flow. `?reset=1` adds an aggressive global CSS reset to show the widget is unaffected;
 * `?disabled=1` loads the script with data-enabled="false", which must render and request nothing.
 */
export function demoPage(o: { page: "agents" | "login"; reset: boolean; disabled?: boolean }): string {
  const reset = o.reset
    ? `<style id="aggressive-reset">
/* An aggressive global reset, of the kind some apps ship: it must not change the toolbar. */
*,*::before,*::after{margin:0!important;padding:0!important;border:0!important;box-sizing:content-box!important;font:inherit!important;color:inherit!important;background:none!important;line-height:3!important;letter-spacing:.2em!important;text-transform:uppercase!important;border-radius:0!important;box-shadow:none!important;transition:none!important;animation:none!important}
html{font-size:8px!important;font-family:"Comic Sans MS",cursive!important;color:#c00!important}
button,input,textarea{all:unset!important}
svg{display:none!important}
div{display:block!important}
[role],[class],[id]{opacity:.98}
</style>`
    : "";
  const main =
    o.page === "login"
      ? `<main class="h-main login">
    <form id="login-form" class="login-card" onsubmit="return false">
      <div class="h-logo big"><i></i>Orbik</div>
      <h1>Sign in</h1>
      <label>Email<input type="email" name="email" placeholder="you@company.com"></label>
      <label>Password<input type="password" name="password"></label>
      <button class="sign-in" type="submit">Sign in</button>
      <p class="fine">No account? Ask your workspace owner for an invite.</p>
    </form>
  </main>`
      : `<main class="h-main">
    <h1>Agents</h1>
    <p class="lead">Each agent reads the crawled site and writes what it finds. Start one by hand, or set it to work on a schedule.</p>
    <div class="h-tiles">
      <div class="h-tile"><small>Pages crawled</small><strong>2,614</strong></div>
      <div class="h-tile"><small>Runs this month</small><strong>38</strong></div>
      <div class="h-tile"><small>Model spend this month</small><strong>$14.20</strong></div>
    </div>
    <div class="h-card">
      <table>
        <thead><tr><th>Agent</th><th>Last run</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr><td>Business Knowledge Base</td><td>Today, 09:12</td><td><span class="chip ok">Up to date</span></td><td><button class="h-btn" id="run-kb">Run</button></td></tr>
          <tr><td>Technical SEO audit</td><td>Yesterday</td><td><span class="chip run">Running</span></td><td><button class="h-btn" data-fail>Run</button></td></tr>
          <tr><td>Image alt text</td><td>3 days ago</td><td><span class="chip">Idle</span></td><td><button class="h-btn">Run</button></td></tr>
          <tr><td>Lighthouse Page Speed</td><td>Never</td><td><span class="chip">Not set up</span></td><td><button class="h-btn primary">Set up</button></td></tr>
          <tr><td>Competitor topic gap</td><td>Last week</td><td><span class="chip ok">Up to date</span></td><td><button class="h-btn">Crawl now</button></td></tr>
        </tbody>
      </table>
    </div>
    <h2>Recent activity</h2>
    <ul class="activity">${Array.from({ length: 14 }, (_, i) => `<li><b>${["Crawl", "Run", "Library edit", "Invite"][i % 4]}</b> · ${["Business Knowledge Base", "Technical SEO audit", "/00 Start Here/overview", "anna@codalent.com"][i % 4]}<span>${i + 1} h ago</span></li>`).join("")}</ul>
  </main>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.page === "login" ? "Sign in — Orbik" : "Agents — Orbik"}</title>
<!-- The toolbar, loaded early so it hears console errors from the start. -->
<script src="/${NAME}.js"${o.disabled ? ' data-enabled="false"' : ""}></script>
<style>
:root{--host-bg:#f4f4f5;--host-surface:#fff;--host-ink:#18181b;--host-muted:#71717a;--host-line:#e4e4e7;--host-brand:#2f5d50;color-scheme:light}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--host-bg);color:var(--host-ink);font-size:14px;line-height:1.45;overflow:hidden}
button,input{font:inherit;color:inherit}
#host{position:absolute;inset:0;display:grid;grid-template-columns:220px 1fr;grid-template-rows:52px 1fr}
.h-top{grid-column:1/-1;display:flex;align-items:center;gap:18px;padding:0 20px;background:var(--host-surface);border-bottom:1px solid var(--host-line)}
.h-logo{display:flex;align-items:center;gap:9px;font-weight:600;letter-spacing:.2px}
.h-logo i{width:22px;height:22px;border-radius:6px;background:var(--host-brand);display:inline-block}
.h-crumb{color:var(--host-muted);font-size:13px}.h-crumb b{color:var(--host-ink);font-weight:500}
.h-top .sp{flex:1}
.h-avatar{width:28px;height:28px;border-radius:50%;background:#d9e3df;border:1px solid var(--host-line)}
.h-rail{background:var(--host-surface);border-right:1px solid var(--host-line);padding:14px 10px;display:flex;flex-direction:column;gap:2px}
.h-rail a{display:block;padding:8px 12px;border-radius:7px;color:var(--host-muted);text-decoration:none;font-size:13.5px}
.h-rail a.on{background:#eaf1ee;color:var(--host-brand);font-weight:500}
.h-main{padding:28px 32px;overflow:auto}
.h-main h1{font-size:22px;font-weight:600;margin:0 0 4px}
.h-main h2{font-size:15px;font-weight:600;margin:26px 0 10px}
.h-main p.lead{margin:0 0 22px;color:var(--host-muted);max-width:62ch}
.h-card{background:var(--host-surface);border:1px solid var(--host-line);border-radius:12px;overflow:hidden}
.h-card table{width:100%;border-collapse:collapse;font-size:13.5px}
.h-card th{text-align:left;font-weight:500;color:var(--host-muted);padding:11px 16px;border-bottom:1px solid var(--host-line);font-size:12.5px}
.h-card td{padding:13px 16px;border-bottom:1px solid var(--host-line);vertical-align:middle}
.h-card tr:last-child td{border-bottom:0}
.chip{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;font-size:12px;background:#f0f0f2;color:#52525b}
.chip.ok{background:#e4f5ec;color:#1f6b45}.chip.run{background:#fff3d6;color:#8a5a00}
.h-btn{border:1px solid var(--host-line);background:#fff;border-radius:7px;padding:5px 11px;font-size:13px;cursor:pointer}
.h-btn.primary{background:var(--host-brand);border-color:var(--host-brand);color:#fff}
.h-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}
.h-tile{background:var(--host-surface);border:1px solid var(--host-line);border-radius:12px;padding:14px 16px}
.h-tile small{display:block;color:var(--host-muted);font-size:12px}
.h-tile strong{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.activity{list-style:none;margin:0;padding:0;background:var(--host-surface);border:1px solid var(--host-line);border-radius:12px}
.activity li{padding:11px 16px;border-bottom:1px solid var(--host-line);display:flex;gap:6px}
.activity li span{margin-left:auto;color:var(--host-muted)}
.login{display:grid;place-items:center}
.login-card{width:340px;background:var(--host-surface);border:1px solid var(--host-line);border-radius:14px;padding:26px;display:flex;flex-direction:column;gap:12px;position:relative}
.login-card .h-logo.big{font-size:16px}
.login-card label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--host-muted)}
.login-card input{border:1px solid var(--host-line);border-radius:8px;padding:8px 10px;color:var(--host-ink)}
.login-card .fine{font-size:12px;color:var(--host-muted);margin:0}
.sign-in{background:var(--host-brand);color:#fff;border:0;border-radius:8px;padding:9px 12px;font-weight:500;cursor:pointer}
@media (max-width:520px){.sign-in{position:absolute;top:22px;right:26px;width:120px}}
@media (max-width:900px){#host{grid-template-columns:1fr}.h-rail{display:none}.h-tiles{grid-template-columns:1fr}}
</style>
${reset}
</head>
<body>
<div id="host">
  <div class="h-top">
    <div class="h-logo"><i></i>Orbik</div>
    <div class="h-crumb">Codalent <span>/</span> <b>${o.page === "login" ? "Sign in" : "Agents"}</b></div>
    <span class="sp"></span>
    <a class="h-btn" href="/demo/login?next=%2Fworkspaces">Sign-in page</a>
    <a class="h-btn" href="/demo">Agents page</a>
    <div class="h-avatar" title="Account"></div>
  </div>
  <nav class="h-rail" aria-label="Sections">
    <a href="#">Home</a><a href="#">Library</a><a href="/demo" class="${o.page === "agents" ? "on" : ""}">Agents</a><a href="#">Competitors</a><a href="#">Brand</a><a href="#">Activity</a><a href="/demo/login?next=%2Fworkspaces" class="${o.page === "login" ? "on" : ""}">Sign in</a>
  </nav>
  ${main}
</div>
<script>
  // Something for the console toggle to find, as a real app in development would have.
  console.warn('Warning: Each child in a list should have a unique "key" prop.');
  document.querySelectorAll("[data-fail]").forEach(function (b) {
    b.addEventListener("click", function () { console.error(new Error("Run failed: 502 from /v1/agents/seo-audit/run")); });
  });
  var kb = document.getElementById("run-kb");
  if (kb) kb.addEventListener("click", function () { Promise.reject(new Error("Network request failed")); });
</script>
</body>
</html>`;
}
