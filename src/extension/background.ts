/// <reference types="chrome" />
/**
 * The extension's service worker. Clicking the toolbar icon (or Alt+Shift+D) puts devbar on the
 * page: `devbar.js` into the extension's isolated world, where the page's CSP and scripts cannot
 * reach the toolbar, and `console.js` into the page's own world, to hear its console. Clicking
 * again folds or hides it. The click grants `activeTab`, which also lets the toolbar ask for a
 * screenshot of the tab here.
 *
 * A feedback session lives here too (see session-store.ts): it is put back on the page after each
 * page load in the tabs it follows. Chrome keeps the click's access while the tab stays on the same
 * site; on another site, one more click on the icon picks the session up again.
 */
import { CAPTURE } from "./shared.js";
import { handleSessionMessage, loadSession, showSessionBadge, tabClosed } from "./session-store.js";

type Mode = "click" | "resume";

const TITLE = chrome.runtime.getManifest().action?.default_title ?? "devbar";

chrome.action.onClicked.addListener((tab) => void activate(tab));

async function inject(tabId: number, mode: Mode): Promise<void> {
  const target = { tabId };
  await chrome.scripting.executeScript({ target, files: ["devbar.js"] });
  await chrome.scripting.executeScript({ target, files: ["console.js"], world: "MAIN" });
  await chrome.scripting.executeScript({
    target,
    func: (m: Mode) => (globalThis as unknown as { __devbarExtension?: { run(m: Mode): void } }).__devbarExtension?.run(m),
    args: [mode],
  });
}

async function activate(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  try {
    await inject(tab.id, "click");
    await chrome.action.setTitle({ tabId: tab.id, title: TITLE });
  } catch {
    // chrome:// pages, the Web Store, the PDF viewer, file:// without permission.
    await flag(tab.id, "devbar can't run on this page");
  }
}

async function flag(tabId: number, title: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#ff6b6b" });
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    // Back to the session's count, if there is one (the global badge shows through again).
    void chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
    void loadSession().then((s) => chrome.action.setBadgeText({ tabId, text: s ? String(s.comments.length) : "" })).catch(() => undefined);
    void chrome.action.setTitle({ tabId, title: TITLE }).catch(() => undefined);
  }, 4000);
}

// After a page load in a tab the session follows, put devbar back with the session on.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete") return;
  void (async () => {
    const session = await loadSession();
    if (!session?.tabs.includes(tabId)) return;
    try {
      await inject(tabId, "resume");
      await chrome.action.setTitle({ tabId, title: TITLE });
    } catch {
      // Another site: the click's access is gone until the icon is clicked here.
      await chrome.action.setTitle({ tabId, title: "devbar: click to continue your feedback session on this page" }).catch(() => undefined);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => void tabClosed(tabId));
chrome.runtime.onStartup.addListener(() => void loadSession().then(showSessionBadge));

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || typeof message?.type !== "string") return;
  if (message.type.startsWith("session:")) {
    if (sender.tab?.id === undefined || sender.frameId !== 0) return;
    handleSessionMessage(message, sender.tab.id).then(reply, (error: Error) => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message.type !== CAPTURE) return;
  const tab = sender.tab;
  // Only the tab that is on screen can be captured, and only the toolbar's own frame asks.
  if (!tab?.active || tab.windowId === undefined || sender.frameId !== 0) {
    reply({ error: "the tab is not on screen" });
    return;
  }
  chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }).then(
    (dataUrl) => reply({ dataUrl }),
    (error: Error) => reply({ error: error.message }),
  );
  return true; // answers asynchronously
});
