import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const runtime = resolve(root, ".wrangler", "dev-tools");
mkdirSync(runtime, { recursive: true });
const env = {
  ...process.env,
  XDG_CONFIG_HOME: runtime,
  WRANGLER_LOG_PATH: resolve(runtime, "wrangler.log"),
  CLOUDFLARE_SEND_METRICS: "false",
  CI: "true",
};
const children = new Set();
let stopping = false;
function launch(args) {
  const child = spawn(npm, ["run", ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", (e) => {
    console.error(e.message);
    stop(1);
  });
  return child;
}
function run(args) {
  return new Promise((resolve, reject) => {
    const p = launch(args);
    p.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`명령 실패: npm run ${args.join(" ")}`)),
    );
    p.once("error", reject);
  });
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of children) p.kill("SIGTERM");
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
try {
  await run(["doctor"]);
  if (!existsSync(resolve(root, "dist", "index.html"))) await run(["build"]);
  await run(["db:local"]);
  if (!stopping) {
    const server = launch(["server", "--", "--port", "8787"]);
    const ui = launch(["dev", "--", "--port", "5173", "--strictPort"]);
    server.once("exit", (code) => stop(code || 0));
    ui.once("exit", (code) => stop(code || 0));
    console.log(
      "\n모아 개발 주소: http://localhost:5173\n처음 실행할 때 서버 준비까지 잠시 기다려주세요. Ctrl+C로 종료합니다.\n",
    );
  }
} catch (e) {
  console.error(e.message);
  stop(1);
}
