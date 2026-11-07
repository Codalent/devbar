#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { DEFAULT_PORT, DIR_NAME, NAME, PACKAGE, STATUSES } from "./name.js";
import { defaultConfig } from "./server/config.js";
import { readVersion, startServer } from "./server/index.js";

const HELP = `${NAME} — log tasks, bugs and ideas from your running app as Markdown files

Usage
  ${NAME} init [--dir <folder>] [--yes]     make ${DIR_NAME}/ with its five status folders and config.json
  ${NAME} [start] [--port <n>] [--dir <folder>] [--open]
                                         start the local server on 127.0.0.1 (default port ${DEFAULT_PORT})
  ${NAME} --help | --version

Options
  --dir <folder>   the data folder (default ./${DIR_NAME})
  --port <n>       the port (default: config.json "port", else ${DEFAULT_PORT})
  --open           open the server's page in the browser once it is up
  --yes, -y        init: append the agent paragraph to AGENTS.md / CLAUDE.md without asking

Then add one line to your app, in development only:
  <script src="http://127.0.0.1:${DEFAULT_PORT}/${NAME}.js"></script>
or, in React / Next:  import { DevBar } from "${PACKAGE}/react"
                      and render <DevBar server="http://127.0.0.1:${DEFAULT_PORT}" /> once.
`;

const MARKER = `<!-- ${NAME}: task folders -->`;
const AGENT_PARAGRAPH = `${MARKER}
## Tasks, bugs and ideas (\`${DIR_NAME}/\`)

Items logged from the running app with ${NAME} are Markdown files in \`${DIR_NAME}/\`, one file per
item, in a folder per status: \`backlog/\` (someday), \`open/\` (wanted, not yet approved),
\`in-progress/\`, \`ready/\` and \`closed/\`. **Ready means approved to build.** Pick work from
\`${DIR_NAME}/ready/\`; move the file to \`${DIR_NAME}/in-progress/\` when you start and to
\`${DIR_NAME}/closed/\` when the work is done and verified, keeping its file name. Do not move an
item into \`ready/\` yourself: a person approves it. The front matter records the page, browser,
selected element and console errors at the time; screenshots are in \`${DIR_NAME}/assets/\`.
`;

interface Args {
  command: string;
  dir: string;
  port?: number;
  open: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args | "help" | "version" {
  const args: Args = { command: "start", dir: DIR_NAME, open: false, yes: false };
  const rest = [...argv];
  let sawCommand = false;
  while (rest.length) {
    const a = rest.shift()!;
    const [flag, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const value = () => {
      const v = inline ?? rest.shift();
      if (v === undefined || v.startsWith("-")) fail(`${flag} needs a value.`);
      return v!;
    };
    if (flag === "-h" || flag === "--help" || flag === "help") return "help";
    if (flag === "-v" || flag === "--version") return "version";
    if (flag === "--dir") args.dir = value();
    else if (flag === "--port" || flag === "-p") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1 || n > 65535) fail("--port must be a number from 1 to 65535.");
      args.port = n;
    } else if (flag === "--open") args.open = true;
    else if (flag === "--yes" || flag === "-y") args.yes = true;
    else if (!flag.startsWith("-") && !sawCommand && ["init", "start"].includes(flag)) {
      args.command = flag;
      sawCommand = true;
    } else fail(`Unknown argument: ${a}. Run \`${NAME} --help\`.`);
  }
  return args;
}

function fail(message: string): never {
  console.error(`${NAME}: ${message}`);
  process.exit(1);
}

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } catch {
    process.stdout.write("\n");
    return false; // Ctrl+C or Ctrl+D: take it as no
  } finally {
    rl.close();
  }
}

async function projectName(root: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    if (typeof pkg.name === "string" && pkg.name) return pkg.name;
  } catch {
    // no package.json
  }
  return path.basename(root);
}

async function init(args: Args): Promise<void> {
  const dataDir = path.resolve(args.dir);
  const root = path.dirname(dataDir);
  const shown = path.relative(process.cwd(), dataDir) || DIR_NAME;
  const config = defaultConfig(await projectName(root));
  if (args.port) config.port = args.port;
  const made: string[] = [];
  for (const folder of [...STATUSES, "assets"]) {
    const dir = path.join(dataDir, folder);
    if (!existsSync(dir)) made.push(`${shown}/${folder}/`);
    await mkdir(dir, { recursive: true });
    // Git does not keep empty folders; this keeps all five in the repository from the start.
    const keep = path.join(dir, ".gitkeep");
    if (!existsSync(keep)) await writeFile(keep, "");
  }
  const configPath = path.join(dataDir, "config.json");
  if (!existsSync(configPath)) {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    made.push(`${shown}/config.json`);
  }
  console.log(made.length ? `Made ${made.join(", ")}` : `${shown}/ is already set up; nothing changed.`);

  // Offer the agent paragraph to whichever instructions file the project has.
  const candidates = ["AGENTS.md", "CLAUDE.md"].map((f) => path.join(root, f));
  const existing = candidates.filter((f) => existsSync(f));
  for (const file of existing) {
    if ((await readFile(file, "utf8")).includes(MARKER)) {
      console.log(`${path.basename(file)} already explains ${DIR_NAME}/.`);
      return printNext();
    }
  }
  // AGENTS.md when there is one (a CLAUDE.md beside it usually imports it), else CLAUDE.md, else a new AGENTS.md.
  const target = existing[0] ?? candidates[0];
  const name = path.basename(target);
  const verb = existsSync(target) ? `Append a paragraph about ${DIR_NAME}/ to ${name}` : `Create ${name} with a paragraph about ${DIR_NAME}/`;
  let go = args.yes;
  if (!go) {
    if (process.stdin.isTTY) go = await ask(`${verb} so AI coding agents know Ready means "approved to build"? [Y/n] `);
    else console.log(`Skipped ${name}: run \`npx ${PACKAGE} init --yes\` to add the agent paragraph.`);
  }
  if (go) {
    const before = existsSync(target) ? await readFile(target, "utf8") : "";
    const sep = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    await appendFile(target, `${sep}${AGENT_PARAGRAPH}`);
    console.log(`${before ? "Appended to" : "Wrote"} ${name}.`);
  }
  printNext();
}

function printNext(): void {
  console.log(`\nNext: run \`npx ${PACKAGE}\` and add to your app, in development only:\n  <script src="http://127.0.0.1:${DEFAULT_PORT}/${NAME}.js"></script>`);
}

function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const argv = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, argv, { stdio: "ignore", detached: true }).unref();
  } catch {
    // no browser to open; the URL is printed anyway
  }
}

async function start(args: Args): Promise<void> {
  const dataDir = path.resolve(args.dir);
  const shown = path.relative(process.cwd(), dataDir) || DIR_NAME;
  if (!existsSync(dataDir)) fail(`no ${shown}/ folder here. Run \`npx ${PACKAGE} init\` in the project root first, or pass --dir.`);
  const version = await readVersion();
  let server;
  try {
    server = await startServer({ dir: dataDir, port: args.port });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE") fail(`port ${args.port ?? "from config.json"} is in use. Is ${NAME} already running? Use --port to pick another.`);
    throw error;
  }
  console.log(`${NAME} ${version} · ${server.config.project}
  files    ${shown}/
  server   ${server.url}
  widget   <script src="${server.url}/${NAME}.js"></script>
  demo     ${server.url}/demo
Press Ctrl+C to stop.`);
  if (args.open) openInBrowser(`${server.url}/`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed === "help") console.log(HELP);
else if (parsed === "version") console.log(await readVersion());
else if (parsed.command === "init") await init(parsed);
else await start(parsed);
