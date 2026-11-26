import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const isWin = process.platform === "win32";

const venvUvicorn = isWin
  ? path.join(root, ".venv", "Scripts", "uvicorn.exe")
  : path.join(root, ".venv", "bin", "uvicorn");

const uvicornBin = fs.existsSync(venvUvicorn) ? venvUvicorn : "uvicorn";
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const apiProc = spawn(
  uvicornBin,
  ["api.index:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
  { stdio: "inherit", cwd: root, shell: isWin && !fs.existsSync(venvUvicorn) }
);

const webProc = fs.existsSync(nextBin)
  ? spawn(process.execPath, [nextBin, "dev"], { stdio: "inherit", cwd: root })
  : spawn(isWin ? "npx.cmd" : "npx", ["next", "dev"], {
      stdio: "inherit",
      cwd: root,
      shell: isWin,
    });

function shutdown(code = 0) {
  if (!apiProc.killed) apiProc.kill();
  if (!webProc.killed) webProc.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
apiProc.on("exit", (code) => shutdown(code ?? 0));
webProc.on("exit", (code) => shutdown(code ?? 0));
