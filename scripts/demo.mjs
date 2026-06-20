// README 用のデモ GIF を生成する。
// dev サーバ（npm run dev）を起動した状態で実行すると、コントローラを台本どおりに
// 操作しながらコマ送りでスクリーンショットを撮り、ffmpeg で GIF にまとめる。
//
//   npm run dev &
//   node scripts/demo.mjs            # docs/images/demo.gif を生成
//
// 環境変数:
//   VJ_URL       配信 URL（既定 http://localhost:5173）
//   CHROME_PATH  Chrome 実行パス（既定は macOS の Google Chrome）

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_URL, launch, dropFile, sleep } from "../test/helpers.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const outDir = join(repoRoot, "docs", "images");
const outGif = join(outDir, "demo.gif");

const FPS = 10; // GIF のフレームレート（ファイルサイズと滑らかさのバランス）

// デモ用の動きのある素材を ffmpeg で生成する（テストの単色より見栄えする）。
function makeDemoVideo(path, lavfi) {
  if (existsSync(path)) return;
  execFileSync("ffmpeg", [
    "-loglevel", "error",
    "-f", "lavfi", "-i", lavfi,
    "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-y", path,
  ]);
}

const assetDir = mkdtempSync(join(tmpdir(), "browser-vj-demo-"));
const demoA = join(assetDir, "demoA.mp4");
const demoB = join(assetDir, "demoB.mp4");

try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ffmpeg が見つかりません。デモ生成には ffmpeg が必要です。");
  process.exit(1);
}

makeDemoVideo(demoA, "life=s=480x270:r=30:ratio=0.1:death_color=#101040:life_color=#40a0ff,format=yuv420p");
makeDemoVideo(demoB, "testsrc2=s=480x270:r=30,hue=H=2*PI*t/3,format=yuv420p");

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 760, deviceScaleFactor: 1 });
await page.goto(DEV_URL, { waitUntil: "networkidle0" });

// コマ送り撮影: 一定間隔でスクショを撮り続け、その裏で台本を進める。
const frameDir = mkdtempSync(join(tmpdir(), "browser-vj-frames-"));
let frameIndex = 0;
let capturing = true;
async function captureLoop() {
  const interval = 1000 / FPS;
  while (capturing) {
    const start = Date.now();
    const file = join(frameDir, `f${String(frameIndex++).padStart(4, "0")}.png`);
    try {
      await page.screenshot({ path: file });
    } catch {
      break; // ページが閉じたら終了
    }
    const elapsed = Date.now() - start;
    if (elapsed < interval) await sleep(interval - elapsed);
  }
}

// フェーダーを現在値から目標値へ滑らかに動かす（クロスフェードを見せる）。
async function glideFader(to, ms) {
  const steps = Math.max(1, Math.round((ms / 1000) * FPS));
  const from = await page.evaluate(() => Number(document.getElementById("fader").value) / 1000);
  for (let i = 1; i <= steps; i++) {
    const v = from + (to - from) * (i / steps);
    await page.evaluate((val) => {
      const f = document.getElementById("fader");
      f.value = String(Math.round(val * 1000));
      f.dispatchEvent(new Event("input"));
    }, v);
    await sleep(ms / steps);
  }
}

const capture = captureLoop();

// --- 台本 ---
await sleep(400);
// ライブラリに素材を登録（サムネ表示を見せる）
await dropFile(page, "#library", demoA, "demoA.mp4");
await dropFile(page, "#library", demoB, "demoB.mp4");
await sleep(1800);
// ライブラリのタイルから Deck A / B へロード
await page.evaluate(() => {
  const tiles = [...document.querySelectorAll("#library-list .entry-tile")];
  tiles[0].querySelectorAll(".entry-actions button")[0].click(); // demoA → A
});
await sleep(1400);
await page.evaluate(() => {
  const tiles = [...document.querySelectorAll("#library-list .entry-tile")];
  const b = tiles[1].querySelectorAll(".entry-actions button");
  b[b.length - 1].click(); // demoB → B
});
await sleep(1400);
await glideFader(1, 2000); // A → B へクロスフェード
await sleep(700);
await glideFader(0, 2000); // B → A へ戻す
await sleep(500);
await page.keyboard.press("w"); // Deck A を少しナッジ
await sleep(300);
await page.keyboard.press("w");
await sleep(1000);

capturing = false;
await capture;
await browser.close();

// --- GIF 化 ---
mkdirSync(outDir, { recursive: true });
// 幅を縮小し色数も抑えてファイルサイズを下げつつ、パレット生成→適用で品質を保つ。
const GIF_WIDTH = 600;
const GIF_COLORS = 128;
const palette = join(frameDir, "palette.png");
const inputPattern = join(frameDir, "f%04d.png");
execFileSync("ffmpeg", [
  "-loglevel", "error",
  "-i", inputPattern,
  "-vf", `scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=max_colors=${GIF_COLORS}:stats_mode=diff`,
  "-y", palette,
]);
execFileSync("ffmpeg", [
  "-loglevel", "error",
  "-framerate", String(FPS),
  "-i", inputPattern,
  "-i", palette,
  "-lavfi", `scale=${GIF_WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
  "-y", outGif,
]);

rmSync(frameDir, { recursive: true, force: true });
rmSync(assetDir, { recursive: true, force: true });
console.log(`生成: ${outGif}（${frameIndex} フレーム）`);
