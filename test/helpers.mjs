import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

export const DEV_URL = process.env.VJ_URL ?? "http://localhost:5173";

// Chrome の実行パス。CHROME_PATH で上書き可。未設定なら macOS の既定を試す。
const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PATH = process.env.CHROME_PATH ?? DEFAULT_CHROME;

export const VIDEO_DURATION_SEC = 4;

// ffmpeg でテスト用 mp4（H.264）を生成し、キャッシュして使い回す。
// lavfiInput は lavfi のソース指定をそのまま渡す（例 "color=red:s=640x360:r=30"）。
// ffmpeg が無い環境では null を返し、呼び出し側でスキップ判断する。
const CACHE_DIR = join(tmpdir(), "browser-vj-test-assets");
export function makeTestVideo(name, lavfiInput) {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    return null;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, name);
  if (!existsSync(path)) {
    execFileSync("ffmpeg", [
      "-loglevel", "error",
      "-f", "lavfi", "-i", lavfiInput,
      "-t", String(VIDEO_DURATION_SEC),
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-y", path,
    ]);
  }
  return path;
}

export async function launch() {
  if (!existsSync(CHROME_PATH)) {
    throw new Error(
      `Chrome が見つかりません: ${CHROME_PATH}\nCHROME_PATH 環境変数で実行パスを指定してください。`,
    );
  }
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"],
  });
}

// ページの JS エラー・console.error を配列に集める。
export function collectErrors(page, label, sink) {
  page.on("pageerror", (e) => sink.push(`${label}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") sink.push(`${label} console: ${m.text()}`);
  });
}

// dataTransfer 付きの drop を合成して、対象セレクタへファイルを流し込む。
export async function dropFile(page, selector, videoPath, fileName) {
  const base64 = readFileSync(videoPath).toString("base64");
  await page.evaluate(
    (sel, data, name) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([bytes], name, { type: "video/mp4" }));
      document.querySelector(sel).dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
      );
    },
    selector,
    base64,
    fileName,
  );
}

// btn-output / btn-preview で開いた出力ウィンドウの Page を取得する。
export async function openOutputWindow(browser, page, buttonId = "btn-output") {
  await page.click(`#${buttonId}`);
  const target = await browser.waitForTarget(
    (t) => t.url().includes("output.html"),
    { timeout: 10000 },
  );
  const output = await target.page();
  await output.waitForSelector("#video-a", { timeout: 10000 });
  return output;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ループ境界をまたいでも正しく測れる時間差。
export function wrapDistance(a, b, duration = VIDEO_DURATION_SEC) {
  const d = Math.abs(a - b) % duration;
  return Math.min(d, duration - d);
}

// 小さな assert ランナー。run() の戻り値を process.exit に使う。
export function createChecker() {
  const failures = [];
  const check = (label, condition, detail = "") => {
    const status = condition ? "PASS" : "FAIL";
    console.log(`${status} ${label}${detail ? ` (${detail})` : ""}`);
    if (!condition) failures.push(label);
  };
  const done = () => {
    console.log(failures.length === 0 ? "\nALL PASS" : `\n${failures.length} FAILURES`);
    return failures.length === 0;
  };
  return { check, done };
}
