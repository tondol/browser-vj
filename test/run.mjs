// dev サーバを起動し、起動を待ってから各スモークテストを順に実行する。
// 終了時にサーバを必ず停止する。
//
//   npm test            すべてのテストを実行
//   node test/run.mjs smoke   指定したテストだけ実行

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const testDir = dirname(fileURLToPath(import.meta.url));
const PORT = 5173;
const URL = `http://localhost:${PORT}`;

const only = process.argv.slice(2);
const allTests = ["smoke", "resilience"];
const tests = only.length ? only : allTests;

function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error("dev server did not start in time"));
      setTimeout(poll, 500);
    };
    poll();
  });
}

function runNode(scriptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: { ...process.env, VJ_URL: URL },
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const server = spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
  cwd: join(testDir, ".."),
  stdio: "ignore",
});

let exitCode = 0;
try {
  await waitForServer(URL);
  for (const name of tests) {
    console.log(`\n=== ${name} ===`);
    const code = await runNode(join(testDir, `${name}.mjs`));
    if (code !== 0) exitCode = code;
  }
} catch (err) {
  console.error(err.message);
  exitCode = 1;
} finally {
  server.kill();
}

process.exit(exitCode);
