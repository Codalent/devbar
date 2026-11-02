/**
 * The toolbar's whole stylesheet. It lives in the shadow root, so it cannot reach the host page;
 * `.root` resets everything the host could pass in by inheritance, custom properties included.
 * Surfaces are flat black glass; only the dot keeps its sheen.
 */
export const CSS = `
.root{all:initial;
  --bar-glass:rgba(10,10,11,.84);--bar-bg:#0a0a0b;--bar-surface:#161618;--bar-raised:#232326;--bar-ink:#fafafa;--bar-muted:#8e8e95;
  --bar-line:rgba(255,255,255,.1);--bar-line-strong:rgba(255,255,255,.18);
  --bug:#ff6b6b;--task:#5aa2ff;--idea:#c59bff;--ok:#34d399;--warn:#fbbf24;
  --font:"devbar Geist","Geist",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono:"devbar Geist Mono","Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --radius:12px;--shadow:0 20px 50px rgba(0,0,0,.4),0 0 0 1px rgba(0,0,0,.5);
  --spring:cubic-bezier(.34,1.45,.64,1);--ease:cubic-bezier(.2,.8,.2,1);
  display:block;font-family:var(--font);color:var(--bar-ink);font-size:13.5px;line-height:1.4;font-weight:400;
  letter-spacing:normal;text-transform:none;text-align:left;font-style:normal;white-space:normal;word-spacing:normal;
  color-scheme:dark;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;cursor:auto;visibility:visible;
}
.root *,.root *::before,.root *::after{box-sizing:border-box}
/* :where() keeps these resets at zero specificity, so every component rule below wins over them. */
.root :where(button,input,textarea){font:inherit;color:inherit;letter-spacing:inherit;margin:0}
.root :where(button){cursor:pointer;-webkit-appearance:none;appearance:none}
.root :focus{outline:none}
.root :focus-visible{outline:2px solid #fff;outline-offset:2px}
.root [hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){.root *{transition:none!important;animation:none!important}}
.glass{background:var(--bar-glass);backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5);border:1px solid var(--bar-line);box-shadow:var(--shadow)}

/* the dot */
.dot{position:fixed;left:0;top:0;width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.22);background:radial-gradient(120% 120% at 30% 18%,#2c2c31 0%,#0a0a0b 62%);
  box-shadow:0 8px 24px rgba(0,0,0,.32),0 1px 2px rgba(0,0,0,.45),0 0 0 0 rgba(10,10,11,0);display:grid;place-items:center;touch-action:none;user-select:none;-webkit-user-select:none;padding:0;z-index:3;
  transition:transform .45s var(--spring),background .3s var(--ease),border-color .3s,box-shadow .3s var(--ease);will-change:transform}
.dot.snapping{transition:left .5s var(--spring),top .5s var(--spring),transform .45s var(--spring),background .3s,border-color .3s}
.dot:hover{transform:scale(1.08);box-shadow:0 10px 28px rgba(0,0,0,.34),0 1px 2px rgba(0,0,0,.45),0 0 0 6px rgba(10,10,11,.07)}
.dot.dragging{transform:scale(1.12);box-shadow:0 18px 40px rgba(0,0,0,.4),0 2px 4px rgba(0,0,0,.4);cursor:grabbing}
.dot svg{width:14px;height:14px;display:block}
.dot svg path{stroke:#fff;transition:stroke .3s}
.dot.open{transform:rotate(135deg) scale(1.04);background:#fff;border-color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.28),0 0 0 6px rgba(10,10,11,.07)}
.dot.open svg path{stroke:#0a0a0b}
.dot .badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#fff;color:#0a0a0b;font:500 10px/16px var(--mono);
  box-shadow:0 0 0 2px rgba(10,10,11,.9),0 1px 3px rgba(0,0,0,.25);text-align:center;transition:opacity .2s,transform .3s var(--spring)}
.dot.open .badge{opacity:0;transform:scale(.6)}
.dot.off{background:#9c9ca3;border-color:#b5b5bb;box-shadow:0 4px 14px rgba(0,0,0,.2)}
.dot.off svg path{stroke:#f4f4f5}
.dot.off .badge{display:none}
.tip{position:fixed;background:var(--bar-bg);color:var(--bar-ink);padding:7px 10px;border-radius:8px;font-size:12.5px;white-space:nowrap;display:none;box-shadow:var(--shadow);border:1px solid var(--bar-line);z-index:4;pointer-events:none}
.tip code{font-family:var(--mono);color:#fff}
.tip.show{display:block}

/* the two pills */
.pills{position:fixed;display:flex;gap:8px;pointer-events:none;z-index:2}
.pills.h{flex-direction:row}.pills.h.rev{flex-direction:row-reverse}
.pills.v{flex-direction:column}.pills.v.rev{flex-direction:column-reverse}
.pills.v:not(.rev-x){align-items:flex-start}.pills.v.rev-x{align-items:flex-end}
.pill{pointer-events:none;display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 13px 0 11px;border-radius:999px;color:var(--bar-ink);font-weight:500;font-size:13px;letter-spacing:.1px;white-space:nowrap;
  opacity:0;transform:translate(var(--dx,0),var(--dy,0)) scale(.86);transition:opacity .25s var(--ease),transform .5s var(--spring),background .2s;transition-delay:0s}
.pill:hover{background:rgba(28,28,31,.92);border-color:var(--bar-line-strong)}
.pill svg{width:15px;height:15px;flex:none;opacity:.9}
.pill kbd{font:10.5px var(--mono);color:var(--bar-muted);margin-left:4px;border:1px solid var(--bar-line);border-radius:5px;padding:0 5px;line-height:16px}
.pills.show .pill{opacity:1;transform:translate(0,0) scale(1);pointer-events:auto}
.pills.show .pill:nth-child(2){transition-delay:.05s}
.pills:not(.show) .pill:nth-child(1){transition-delay:.04s}
.pills:not(.show) .pill{transition-duration:.18s,.2s,.2s}

/* form */
.form{position:fixed;border-radius:var(--radius);display:none;width:376px;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);overflow:auto;transform-origin:var(--ox,100%) var(--oy,100%);z-index:2}
.form.show{display:block;animation:pop .35s var(--spring)}
.form.away{visibility:hidden}
@keyframes pop{from{opacity:0;transform:scale(.92) translateY(8px)}to{opacity:1;transform:none}}
.form header{display:flex;align-items:center;gap:8px;padding:10px 10px 0 12px}
.seg{display:inline-flex;background:var(--bar-surface);border-radius:999px;padding:3px;gap:2px;border:1px solid var(--bar-line)}
.seg button{border:0;background:none;color:var(--bar-muted);padding:4px 11px;border-radius:999px;font-weight:500;font-size:13px;display:flex;align-items:center;gap:7px;transition:background .2s,color .2s}
.seg button i{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.9;display:block}
.seg button[aria-pressed="true"]{background:var(--bar-raised);color:var(--bar-ink)}
.x{margin-left:auto;border:0;background:none;color:var(--bar-muted);width:30px;height:30px;border-radius:999px;font-size:18px;line-height:1;display:grid;place-items:center;flex:none}
.x:hover{background:var(--bar-surface);color:var(--bar-ink)}
.form .body{padding:12px;display:flex;flex-direction:column;gap:10px}
.form label.f{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--bar-muted)}
.form input[type=text],.form textarea,.drawer textarea{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--bar-line);border-radius:9px;padding:8px 10px;color:var(--bar-ink);font-size:13.5px;line-height:1.4;transition:border-color .2s,box-shadow .2s,background .2s}
.form input[type=text]:hover,.form textarea:hover{border-color:var(--bar-line-strong)}
.form input::placeholder,.form textarea::placeholder{color:#6b6b72;opacity:1}
.form textarea{min-height:72px;resize:vertical;font-family:var(--font)}
.form input:focus,.form textarea:focus,.drawer textarea:focus{outline:none;background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.35);box-shadow:0 0 0 3px rgba(255,255,255,.07)}
.form input.invalid{border-color:var(--bug);animation:shake .35s}
@keyframes shake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.row{display:flex;align-items:center;gap:10px}
.row .lbl{font-size:12px;color:var(--bar-muted);width:62px}
.seg.small button{padding:4px 10px;font-size:12.5px;font-weight:400}
.attach{border-top:1px solid var(--bar-line);margin:2px -12px 0;padding:10px 12px 0}
.attach h4{margin:0 0 6px;font-size:11px;font-weight:500;letter-spacing:.5px;text-transform:uppercase;color:var(--bar-muted)}
.tog{display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--bar-line)}
.tog:last-child{border-bottom:0}
.sw{position:relative;width:32px;height:18px;border-radius:999px;background:var(--bar-raised);border:1px solid var(--bar-line);transition:background .2s,border-color .2s;padding:0}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;opacity:.55;transition:transform .35s var(--spring),opacity .2s,background .2s}
.sw[aria-checked="true"]{background:#fff;border-color:#fff}
.sw[aria-checked="true"]::after{transform:translateX(14px);background:#0a0a0b;opacity:1}
.sw:disabled{cursor:default}
.tog .t{font-weight:500}
.tog .d{font:11.5px var(--mono);color:var(--bar-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tog .d.err{color:#ff9d9b}
.tog.disabled .t,.tog.disabled .d{opacity:.45}
.thumb{width:76px;min-height:20px;border-radius:6px;background:var(--bar-surface);border:1px solid var(--bar-line-strong);position:relative;overflow:hidden;display:block}
.thumb img{display:block;width:100%;height:auto}
.thumb .spin{display:block;height:46px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);background-size:200% 100%;animation:shimmer 1.1s linear infinite}
@keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.box{position:absolute;border:2px solid #fff;outline:1px solid rgba(0,0,0,.55);border-radius:3px;box-shadow:0 0 0 2px rgba(0,0,0,.08);pointer-events:none}
.pick{border:1px solid var(--bar-line-strong);background:var(--bar-surface);color:var(--bar-ink);border-radius:999px;padding:4px 11px;font-size:12.5px}
.pick:hover{background:var(--bar-raised)}
.form footer{display:flex;align-items:center;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--bar-line)}
.form footer .path{font:11.5px var(--mono);color:var(--bar-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.btn{border:1px solid var(--bar-line-strong);background:var(--bar-surface);color:var(--bar-ink);border-radius:999px;padding:7px 14px;font-weight:500;transition:background .2s;white-space:nowrap}
.btn:hover{background:var(--bar-raised)}
.btn.primary{background:#fff;border-color:#fff;color:#0a0a0b}
.btn.primary:hover{background:#e8e8ea}
.btn.danger{color:#ff9d9b}
.btn.danger.armed{background:var(--bug);border-color:var(--bug);color:#0a0a0b}
.btn:disabled{opacity:.5;cursor:default}

/* board */
.board{position:fixed;inset:16px;border-radius:16px;display:none;flex-direction:column;overflow:hidden;background:rgba(10,10,11,.92);z-index:1}
.board.show{display:flex;animation:pop .35s var(--spring)}
.board > header{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--bar-line);flex-wrap:wrap}
.board h2{margin:0;font-size:15px;font-weight:600}
.board header .path{font:12px var(--mono);color:var(--bar-muted)}
.board header .sp{flex:1}
.board header .live{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--bar-muted)}
.board header .live i{width:7px;height:7px;border-radius:50%;background:var(--bar-muted);display:block}
.board header .live.on i{background:var(--ok);box-shadow:0 0 0 3px rgba(52,211,153,.18)}
.filters{display:inline-flex;gap:4px}
.filters button{border:1px solid var(--bar-line);background:none;color:var(--bar-muted);border-radius:999px;padding:3px 10px;font-size:12px;display:flex;align-items:center;gap:6px}
.filters button i{width:7px;height:7px;border-radius:50%;display:block}
.filters button[aria-pressed="true"]{background:var(--bar-surface);color:var(--bar-ink);border-color:var(--bar-line-strong)}
.cols{flex:1;display:grid;grid-template-columns:repeat(5,minmax(200px,1fr));gap:10px;padding:12px;overflow:auto;min-height:0}
.col{background:rgba(255,255,255,.03);border-radius:12px;display:flex;flex-direction:column;min-height:0;border:1px solid rgba(255,255,255,.05);transition:border-color .2s,background .2s}
.col.over{border-color:var(--bar-line-strong);background:var(--bar-raised)}
.col h3{margin:0;padding:10px 12px;font-size:11px;font-weight:500;letter-spacing:.5px;text-transform:uppercase;color:var(--bar-muted);display:flex;align-items:center;gap:8px}
.col h3 span{margin-left:auto;font:12px var(--mono);background:var(--bar-raised);padding:1px 7px;border-radius:999px;color:var(--bar-ink);letter-spacing:0}
.col .list{flex:1;display:flex;flex-direction:column;gap:8px;padding:0 8px 8px;overflow:auto;min-height:60px}
.card{background:#111113;border:1px solid var(--bar-line);border-radius:10px;padding:10px 12px;cursor:grab;display:flex;flex-direction:column;gap:6px;transition:border-color .2s;text-align:left;color:var(--bar-ink);width:100%}
.card:hover{border-color:var(--bar-line-strong)}
.card:active{cursor:grabbing}
.card.dragging{opacity:.4}
.card.selected{border-color:rgba(255,255,255,.4)}
.card .top{display:flex;align-items:center;gap:8px;font-size:11.5px}
.card .type{display:inline-flex;align-items:center;gap:5px;color:var(--tc);font-weight:500}
.card .type i{width:7px;height:7px;border-radius:50%;background:var(--tc);box-shadow:0 0 0 3px color-mix(in srgb,var(--tc) 18%,transparent);display:block}
.card .id{margin-left:auto;font-family:var(--mono);color:var(--bar-muted)}
.card .title{font-weight:500;text-wrap:balance;overflow-wrap:anywhere}
.card .meta{display:flex;align-items:center;gap:8px;font:11px var(--mono);color:var(--bar-muted);overflow:hidden}
.card .meta .pg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card .meta .pr{margin-left:auto;padding:0 7px;border-radius:999px;background:var(--bar-raised);font-family:var(--font);font-size:11px}
.card .meta .pr.high{background:rgba(255,107,107,.16);color:#ff9d9b}
.card .meta .shot{width:12px;height:9px;border:1px solid var(--bar-muted);border-radius:2px;flex:none}
.empty{border:1px dashed var(--bar-line-strong);border-radius:10px;padding:14px;font-size:12px;color:var(--bar-muted);text-align:center}
.board .notice{padding:10px 16px;font-size:12.5px;color:var(--bar-muted);border-bottom:1px solid var(--bar-line)}

/* item drawer */
.drawer{position:absolute;top:0;right:0;bottom:0;width:460px;max-width:100%;background:var(--bar-bg);border-left:1px solid var(--bar-line);display:none;flex-direction:column}
.drawer.show{display:flex;animation:slide .3s var(--ease)}
@keyframes slide{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
.drawer header{display:flex;align-items:center;gap:8px;padding:10px 12px 10px 16px;border-bottom:1px solid var(--bar-line)}
.drawer header .file{font:12px var(--mono);color:var(--bar-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.drawer .md{flex:1;overflow:auto;padding:16px;overflow-wrap:anywhere}
.drawer .fm{font:12px/1.6 var(--mono);background:var(--bar-surface);border-radius:10px;padding:10px 12px;color:var(--bar-muted);white-space:pre-wrap;margin:0 0 14px;border:1px solid var(--bar-line)}
.drawer .fm b{color:var(--bar-ink);font-weight:500}
.drawer h1{font-size:17px;margin:0 0 10px;font-weight:600;text-wrap:balance}
.drawer p{margin:0 0 12px;max-width:62ch}
.drawer .h{margin:16px 0 6px;font-size:11px;font-weight:500;letter-spacing:.5px;text-transform:uppercase;color:var(--bar-muted)}
.drawer ul,.drawer ol{margin:0 0 12px;padding-left:20px}
.drawer li{margin:2px 0}
.drawer blockquote{margin:0 0 12px;padding-left:12px;border-left:2px solid var(--bar-line-strong);color:var(--bar-muted)}
.drawer code{font:12px var(--mono);background:var(--bar-surface);padding:1px 5px;border-radius:4px}
.drawer pre.code{font:12px/1.5 var(--mono);background:var(--bar-surface);padding:10px 12px;border-radius:8px;overflow:auto;margin:0 0 12px}
.drawer pre.code code{background:none;padding:0}
.drawer a{color:#fff}
.drawer hr{border:0;border-top:1px solid var(--bar-line);margin:14px 0}
.drawer img{max-width:100%;border-radius:8px;display:block}
.drawer .shotbig{width:100%;border-radius:10px;overflow:hidden;position:relative;background:#f4f4f5;border:1px solid var(--bar-line-strong);margin:0 0 12px}
.drawer .shotbig img{border-radius:0;width:100%}
.drawer textarea.raw{flex:1;margin:12px 16px;width:auto;font:12.5px/1.55 var(--mono);resize:none}
.drawer .move{display:flex;gap:6px;flex-wrap:wrap;padding:12px 64px 12px 16px;border-top:1px solid var(--bar-line);align-items:center}
.drawer .move span{font-size:12px;color:var(--bar-muted);margin-right:4px}
.drawer .move button{border:1px solid var(--bar-line);background:var(--bar-surface);color:var(--bar-ink);border-radius:999px;padding:4px 11px;font-size:12px}
.drawer .move button:hover:not([disabled]){border-color:var(--bar-line-strong)}
.drawer .move button[disabled]{opacity:.35;cursor:default}

/* toast */
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);color:var(--bar-ink);border-radius:999px;padding:8px 14px 8px 11px;display:flex;align-items:center;gap:10px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .25s,transform .45s var(--spring);z-index:6;max-width:calc(100vw - 32px)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.toast i{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(52,211,153,.18);flex:none;display:block}
.toast.bad i{background:var(--bug);box-shadow:0 0 0 3px rgba(255,107,107,.18)}
.toast span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.toast code{font:12px var(--mono);color:#fff}

/* element picker */
.veil{position:fixed;inset:0;cursor:crosshair;z-index:5;display:none;background:transparent}
.veil.show{display:block}
.pickbox{position:fixed;pointer-events:none;border:2px solid #fff;outline:1px solid rgba(0,0,0,.6);background:rgba(255,255,255,.18);border-radius:4px;display:none;z-index:5}
.picklabel{position:fixed;pointer-events:none;background:var(--bar-bg);color:var(--bar-ink);font:11.5px/1 var(--mono);padding:5px 7px;border-radius:5px;display:none;z-index:5;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}
.pickhint{position:fixed;left:50%;top:16px;transform:translateX(-50%);color:var(--bar-ink);padding:8px 14px;border-radius:999px;font-size:13px;display:none;z-index:6;pointer-events:none}
.pickhint kbd{font-family:var(--mono);background:var(--bar-raised);padding:1px 6px;border-radius:4px;font-size:12px}
.veil.show ~ .pickhint{display:block}

@media (max-width:900px){.cols{grid-template-columns:repeat(5,240px)}.drawer{width:100%}.board{inset:8px}}
`;
