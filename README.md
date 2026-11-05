# devbar

A small dev toolbar for any web app. A dot sits in the corner of your app in development; click it to
log a **task, bug or idea** while you are looking at the problem, with a screenshot, the page, the
browser, recent console errors and the element you point at. Each item is saved as a **Markdown file
in your repository**, in a folder per status, where you, your team and your AI coding agent can pick
it up. The same dot opens a **kanban board** of those files, and can **record your screen and voice**
while you walk through what to fix.

Nothing leaves your machine: a tiny local server reads and writes the files, and the widget only runs
in development.

![devbar in action: log a bug with a screenshot, the console error and the picked element, then drag it across the board](docs/demo.gif)

<sub>Logging a bug on the demo page, picking the broken button, saving it as `.devbar/open/009-….md`, then
moving it to Ready on the board. [Watch as MP4](docs/demo.mp4).</sub>

## Install

```sh
npm install --save-dev @codalent/devbar
npx @codalent/devbar init   # makes .devbar/ with five status folders and config.json
npx @codalent/devbar        # starts the local server on http://127.0.0.1:4711
```

Then add **one line** to your app, in development only:

```html
<script src="http://127.0.0.1:4711/devbar.js"></script>
```

React or Next.js, in the root layout:

```tsx
import { DevBar } from "@codalent/devbar/react";
// …
<DevBar />
```

`<DevBar />` renders nothing unless `process.env.NODE_ENV === "development"` (or `enabled` is set), so
a production build renders nothing and loads nothing. Without installing the package, the same thing
in a Next.js root layout is one line:

```tsx
{process.env.NODE_ENV === "development" && <script src="http://127.0.0.1:4711/devbar.js" async />}
```

Load it early (in `<head>`) so the console toggle hears errors from the moment the page starts.
On React 19 `<DevBar />` renders that script tag, which React hoists into `<head>`; on React 18 it adds
the script after the first render.

Other ways in:

- `<script src="…/devbar.js" data-server="http://127.0.0.1:4800">` — talk to a server other than the
  one the script came from (by default, the script's address without `/devbar.js`).
- `<script src="…/devbar.js" data-enabled="false">` — render nothing and make no request.
- `import { mount } from "@codalent/devbar/client"; mount({ server, enabled })` — the widget as a module, for a
  bundler. `enabled` defaults to `process.env.NODE_ENV === "development"`.
- `<DevBar server="http://127.0.0.1:4800" enabled />` — the React props.

### Inside your own server

Instead of running `npx @codalent/devbar`, mount devbar in the Node server your app already has, and import
the widget in your frontend. Nothing else runs; the folder is the same.

```js
// backend (Express, Connect, or any Node http server)
import { createDevbar } from "@codalent/devbar/server";

if (process.env.DEVBAR === "on") {
  const devbar = await createDevbar({
    dir: new URL("../.devbar", import.meta.url).pathname,
    key: process.env.DEVBAR_KEY, // optional: only requests that carry it get in
  });
  app.use("/devbar", devbar.handle); // before a JSON body parser, or exempt /devbar from it
}
```

```js
// frontend, in the browser (a client component in React or Next)
const { mount } = await import("@codalent/devbar/client");
mount({ server: "https://api.example.dev/devbar", enabled: true, key: savedKey });
```

`handle(req, res, next)` answers the paths below relative to where it is mounted, and calls `next`
for any other. It reads the request body itself (an item with a screenshot is a few megabytes) and
uses a body a parser already read (a recording can be hundreds of megabytes; send it raw, not
through a JSON parser). It applies no CORS and no access rules: your server's own apply,
so a page on another origin needs that origin allowed (and the `X-Devbar-Key` header, with a key).
Without a key, anything that can reach the path can read and write the folder. With `key`, every
request must carry it, as an `X-Devbar-Key` header or a `key` query parameter (the event stream and
screenshots use the parameter, since they cannot send headers, so it appears in access logs); any
other request is passed to `next` as if devbar were not there. Give the widget the same key:
`mount({ key })`, `<DevBar key="…" />` or `data-key` on a script tag. Screenshots and the script are sent with
`Cross-Origin-Resource-Policy: cross-origin` so they load across origins whatever your server's
defaults. The landing and demo pages are the standalone server's only (`pages: true` turns them on).
`devbar.close()` stops watching the folder. A script tag works too: the widget takes its server
from the script's own address without `/devbar.js`, so `<script src="/devbar/devbar.js">` needs no
`data-server`.

Open `http://127.0.0.1:4711/demo` to try it on a sample page (`/demo?reset=1` adds an aggressive global
CSS reset, to show the toolbar is unaffected by the host page's CSS).

## Using it

- **The dot** sits bottom-right. Drag it anywhere; it snaps to the nearest edge (keeping its place
  along it) or, near a corner, to the corner, and remembers where you put it. The badge counts items in
  **Open** and **In progress**. A grey dot means the server is not running: hover it for the hint; it
  reconnects by itself when the server comes back and you return to the tab.
- **Click the dot** and three pills unfold: **New task**, **Board** and **Record**.
- **The form** has a title, a Markdown description, a priority and a row of **Attach** switches. Each
  shows what it will attach:

  | Switch | Attaches | Bug | Task | Idea |
  |---|---|---|---|---|
  | Screenshot | the visible page, taken when the form opened, without the toolbar | on | off | off |
  | Page | path and query, page title, origin | on | on | on |
  | Browser and window | browser, OS, window size, device pixel ratio, touch | on | on | off |
  | Console errors | the last 20 console errors and warnings since the page loaded | on | off | off |
  | Selected element | (bugs) press **Pick**, click an element: tag, id, classes, text, a unique CSS selector, its outline on the screenshot | on | – | – |

  Your last choice per type is remembered in the browser; `config.json` can change the defaults.
  **Cancel** writes nothing; what was collected is dropped.
- **Record** asks which screen, window or tab to share, then your microphone, and starts recording
  both. A bar at the bottom of the page shows the time, a level meter for your voice, and three
  buttons: **Pause** (and **Resume**), **Stop**, and **Discard** (press it twice). A paused stretch is
  left out of the video, so you can stop and think. Drag the bar anywhere by its edge. While it runs
  the dot has a red ring. **Stop**, or the browser's own "Stop sharing" button, opens the form with
  the video attached: its length, size, and a preview you can click to watch in a new tab. Give it a
  title and save; Cancel asks once more before dropping the video. Leaving the page while a recording
  runs or waits to be saved asks first, since the video exists only in the page until it is saved.
  Without a microphone it records the screen with no sound and says so. It works in desktop Chrome,
  Edge, Firefox and Safari on a secure page (`localhost` counts), not on phones; Chrome and Firefox
  save WebM, Safari MP4.
- **The board** has five columns. Drag a card to move its file; click a card to read it, edit the
  Markdown, move it or delete it (delete asks twice). Edits you make in your editor show up on the
  board at once.

Keyboard: `Esc` closes whatever is open; with the dot open, `N` = new item, `B` = board and
`R` = record; `Ctrl/⌘ + Shift + .` opens and closes the board from anywhere; `Ctrl/⌘ + Enter` saves the
form. While recording, from anywhere in the page: `Alt/⌥ + Shift + P` pauses and resumes,
`Alt/⌥ + Shift + S` stops; `Alt/⌥ + Shift + R` starts a recording.

## The files

```
.devbar/
  config.json
  backlog/        someday
  open/           wanted, not yet approved
  in-progress/
  ready/          approved: ready to build
  closed/         done
  assets/         screenshots and screen recordings
```

Each item is one file named `NNN-short-slug.md`. The three-digit id is unique across the five folders;
moving an item between statuses moves the file and keeps its name. Commit the folder: the whole team
and every agent then sees the same list. A bug logged with every switch on looks like this:

```markdown
---
id: 001
title: Login button overlaps logo on narrow screens
type: bug
priority: high
created: 2026-11-02T10:12:00+05:30
updated: 2026-11-02T10:12:00+05:30
page: /login?next=%2Fworkspaces
pageTitle: Sign in — Orbik
origin: http://localhost:3100
viewport: 390x844
devicePixelRatio: 3
browser: Chrome 142 on macOS 26
touch: true
screenshot: assets/001-screenshot.png
element: button.sign-in  (#login-form > button)
elementRect: [0.6512, 0.0817, 0.3077, 0.0533]
consoleErrors: 1
---

On an iPhone-sized window the Sign in button sits on top of the logo.

![Screenshot](../assets/001-screenshot.png)

## Selected element
`<button class="sign-in" type="submit">Sign in</button>` — selector `#login-form > button` — text `Sign in`

## Console errors at the time
- Warning: Each child in a list should have a unique "key" prop. (Login.tsx:42)
```

An item saved with a recording has two more fields, and a link to the video under the description:

```markdown
recording: assets/004-recording.webm
recordingDuration: "2:31"
---

The three things to fix on the agents page, in order.

[Screen recording, 2:31](../assets/004-recording.webm)
```

The board plays it above that link. A recording is about 15 MB a minute; if you would rather not
commit them, add `.devbar/assets/*-recording.*` to `.gitignore`.

Only the switches that were on produce a field and a section. The status is the folder, not a field.
`screenshot` is relative to `.devbar/`; the image link in the body climbs one folder (`../assets/…`) so
the picture shows on GitHub and in an editor's Markdown preview from any status folder. Screenshots
are PNG, long side at most 1600 px. `elementRect` is the element's box as fractions of the window
(x, y, width, height), which the board uses to outline it on the screenshot.

You can write items by hand. A file with no front matter still shows on the board, titled by its file
name. The server never rewrites a file except when you edit or move it.

## Working with AI coding agents

Because every item is a Markdown file in the repository, an agent such as Claude Code can work from the
folders: read `.devbar/ready/`, move a file to `in-progress/` when it starts and to `closed/` when the
work is done and verified. **Ready means approved to build**; a person moves items into it.
`npx @codalent/devbar init` offers to append a paragraph saying exactly this to your `AGENTS.md` (or `CLAUDE.md`);
`--yes` appends without asking.

## Configuration

`.devbar/config.json` (all keys optional):

| Key | Default | Meaning |
|---|---|---|
| `project` | package.json `name`, else the folder name | shown in the board's header |
| `port` | `4711` | the server's port (`--port` wins) |
| `position` | `"bottom-right"` | where the dot starts: `bottom-right`, `bottom-left`, `top-right`, `top-left` |
| `shortcut` | `"mod+shift+."` | opens and closes the board; `mod` is Ctrl or ⌘ |
| `folders` | the status names, and `assets` | folder name per status and for screenshots |
| `toggles` | see the table above | default switches per type, e.g. `{ "task": { "screenshot": true } }` |

The five statuses are fixed in this version.

## CLI

```
devbar init [--dir <folder>] [--yes]
devbar [start] [--port <n>] [--dir <folder>] [--open]
devbar --help | --version
```

## The server and its API

`devbar` starts a Node server (Node 20+) that listens on **127.0.0.1 only**. It answers pages on
`http://localhost:*`, `http://127.0.0.1:*` and `http://[::1]:*` and refuses every other origin and any
request whose `Host` is not a loopback name. It never touches a path outside the data folder.

| Route | |
|---|---|
| `GET /api/health` | `{ name, version, dir, counts, config }` |
| `GET /api/items` | every item with its status and front matter |
| `POST /api/items` | create: `{ type, title, description, priority, status?, context? }`; the server assigns the id and file name. `context` may hold `page`, `browser`, `console`, `element`, `screenshot` (a PNG data URL) and `recording` (`{ mimeType, duration }`: the file names the video, which follows) |
| `PUT /api/items/:id/recording` | the video itself, as the raw body with `Content-Type: video/webm` or `video/mp4` (up to 2 GB), for an item created with `context.recording` |
| `GET /api/items/:id` | one item, with its raw `markdown` and `body` |
| `PUT /api/items/:id` | `{ markdown }` replaces the file; or `{ title?, type?, priority? }` edits those fields |
| `POST /api/items/:id/move` | `{ status }` moves the file |
| `DELETE /api/items/:id` | deletes the file and the screenshot and recording it made |
| `GET /api/events` | Server-Sent Events: `change` whenever a file in the folder changes |
| `GET /assets/:name` | a stored screenshot or recording (with `Range` support, so a player can seek) |
| `GET /devbar.js` | the widget |
| `GET /demo` | a sample page with the widget |

`:id` is the number (`001`, or `1`), or the file name without `.md` for a hand-made file with no
number. Ids are assigned from the highest number in all five folders and `assets/`; saves are queued,
so two at once never collide.

## How the widget stays out of your way

It is one custom element (`<devbar-toolbar>`) with its own shadow root: no global CSS, no framework,
one global (`window.__devbar`) for debugging, a fixed z-index. Its fonts (Geist, Geist Mono) are
added under their own names, so your page cannot pick them up. Your CSS cannot restyle it and it cannot
restyle your page. Screenshots are drawn in the browser with
[html-to-image](https://github.com/bubkoo/html-to-image) (patched in `patches/` so scrolled panes are
drawn where they are scrolled to); when a page cannot be drawn, the form says so and the item is saved
without one. The widget wraps `console.error` and `console.warn` to keep the last twenty; its source
map puts it on Chrome's ignore list so DevTools still shows your own line for each message.

When the server is not running the dot turns grey, the console gets one quiet notice, and the widget
retries after 2, 4, 8, 16 and 32 seconds. After that it stops polling and retries only when the tab
regains focus or becomes visible, or you hover or click the dot. The browser itself logs each refused
request and no script can silence that, so the retries are kept few.

## Not in this version

A Vite or Next plugin; GitHub Issues sync; assignees and
due dates; custom statuses; comments; use on a deployed staging site (it would need auth and a hosted
store); recording the steps before a bug.

## Developing devbar

```sh
pnpm install
pnpm build            # dist/: cli, server, devbar.js (script tag), client, react
node dist/cli.js      # run it from a project folder with a .devbar/
```

There are no automated tests by design: verify a change by running the server and using the demo page.
