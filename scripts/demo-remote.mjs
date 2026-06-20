// SNS 向けの「スマホでリモコン」デモ GIF を生成する。
// 中継サーバ（bridge/server.mjs）を起動した状態で実行すると、
//   - コントローラ（index.html、画面外の司令塔）
//   - 出力ウィンドウ（output.html）… 左に配置
//   - リモコン（remote.html）… 右にスマホ枠で配置
// の3ページを Puppeteer で開き、リモコンを実際に操作して（本物の WebSocket が
// 流れる）、出力が反応する様子を左右に並べたコマで撮影し、ffmpeg で GIF 化する。
//
//   node bridge/server.mjs &
//   npm run dev &
//   node scripts/demo-remote.mjs       # docs/images/demo-remote.gif を生成
//
// 環境変数:
//   VJ_URL       コントローラ/出力の配信 URL（既定 http://localhost:5173）
//   REMOTE_URL   リモコンの配信 URL（既定 http://localhost:8787）
//   CHROME_PATH  Chrome 実行パス（既定は macOS の Google Chrome）

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_URL, launch, dropFile, openOutputWindow, sleep } from "../test/helpers.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const outDir = join(repoRoot, "docs", "images");
const outGif = join(outDir, "demo-remote.gif");
const REMOTE_URL = process.env.REMOTE_URL ?? "http://localhost:8787";

const FPS = 10;
// 出力・リモコンそれぞれの撮影サイズ（縦をそろえて横に並べる）。
const OUT_W = 640, OUT_H = 360; // 出力（16:9）
const PHONE_W = 300, PHONE_H = 600; // スマホ枠（縦長）
const CANVAS_H = 680; // 合成キャンバスの高さ（上部ラベル帯＋スマホ枠が収まる高さ）

function ensureServer(url, hint) {
  try {
    execFileSync("curl", ["-sf", "-o", "/dev/null", url]);
  } catch {
    console.error(`${url} に繋がりません。先に ${hint} を起動してください。`);
    process.exit(1);
  }
}
ensureServer(DEV_URL, "npm run dev");
ensureServer(REMOTE_URL, "node bridge/server.mjs");

try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ffmpeg が見つかりません。");
  process.exit(1);
}

// デモ用の動きのある素材を生成。
const assetDir = mkdtempSync(join(tmpdir(), "browser-vj-demo-"));
function makeDemoVideo(path, lavfi) {
  if (existsSync(path)) return;
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-f", "lavfi", "-i", lavfi,
    "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", path,
  ]);
}
const demoA = join(assetDir, "demoA.mp4");
const demoB = join(assetDir, "demoB.mp4");
makeDemoVideo(demoA, "life=s=480x270:r=30:ratio=0.1:death_color=#101040:life_color=#40a0ff,format=yuv420p");
makeDemoVideo(demoB, "testsrc2=s=480x270:r=30,hue=H=2*PI*t/3,format=yuv420p");

const browser = await launch();

// コントローラ（司令塔）。ライブラリに素材を入れておく。
const controller = await browser.newPage();
await controller.setViewport({ width: 900, height: 760 });
await controller.goto(DEV_URL, { waitUntil: "networkidle0" });
await dropFile(controller, "#library", demoA, "demoA.mp4");
await dropFile(controller, "#library", demoB, "demoB.mp4");
await sleep(1200); // サムネ生成を待つ

// 出力ウィンドウ。
const output = await openOutputWindow(browser, controller);
await output.setViewport({ width: OUT_W, height: OUT_H });

// リモコン。
const phone = await browser.newPage();
await phone.setViewport({ width: PHONE_W, height: PHONE_H, isMobile: true, hasTouch: true });
await phone.goto(REMOTE_URL, { waitUntil: "networkidle0" });
await sleep(800); // WS 接続とライブラリ受信を待つ

// ラベル帯（PC OUTPUT / PHONE REMOTE）を HTML で描いて透過 PNG にする。
// このビルドの ffmpeg には drawtext が無いため、ブラウザでテキストを描画する。
const labelPage = await browser.newPage();
async function renderLabel(text, width) {
  await labelPage.setViewport({ width, height: 44, deviceScaleFactor: 1 });
  await labelPage.goto(
    "data:text/html," +
      encodeURIComponent(
        `<body style="margin:0;display:flex;align-items:center;justify-content:center;` +
          `height:44px;font:600 22px system-ui,sans-serif;color:#fff;letter-spacing:.08em">` +
          `${text}</body>`,
      ),
    { waitUntil: "networkidle0" },
  );
  const file = join(assetDir, `label-${text.replace(/\W+/g, "")}.png`);
  await labelPage.screenshot({ path: file, omitBackground: true });
  return file;
}
const labelOut = await renderLabel("PC OUTPUT", OUT_W);
const labelPhone = await renderLabel("PHONE REMOTE", PHONE_W);
await labelPage.close();

// --- コマ送り撮影（出力とリモコンを個別に撮り、後で横並び合成）---
const frameDir = mkdtempSync(join(tmpdir(), "browser-vj-frames-"));
let frameIndex = 0;
let capturing = true;
async function captureLoop() {
  const interval = 1000 / FPS;
  while (capturing) {
    const start = Date.now();
    const i = String(frameIndex++).padStart(4, "0");
    try {
      await Promise.all([
        output.screenshot({ path: join(frameDir, `o${i}.png`) }),
        phone.screenshot({ path: join(frameDir, `p${i}.png`) }),
      ]);
    } catch {
      break;
    }
    const elapsed = Date.now() - start;
    if (elapsed < interval) await sleep(interval - elapsed);
  }
}

// リモコンのライブラリ n 番目のタイルの「→A/→B」を押す（A=0, B=末尾）。
async function remoteLoad(tileIndex, deck) {
  await phone.evaluate((idx, d) => {
    const rows = [...document.querySelectorAll("#library .lib-entry")];
    const btns = rows[idx].querySelectorAll("button[data-deck]");
    const btn = d === "a" ? btns[0] : btns[btns.length - 1];
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  }, tileIndex, deck);
}
// リモコンの data-key ボタンを押す。
async function remoteKey(code) {
  await phone.evaluate((c) => {
    const btn = document.querySelector(`button[data-key="${c}"]`);
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  }, code);
}

const capture = captureLoop();

// --- 台本（スマホから操作する）---
await sleep(600);
await remoteLoad(0, "a"); // demoA → Deck A
await sleep(1600);
await remoteLoad(1, "b"); // demoB → Deck B
await sleep(1600);
await remoteKey("ArrowRight"); // フェーダーを B 寄りへ
await sleep(400);
await remoteKey("ArrowRight");
await sleep(400);
await remoteKey("Digit2"); // B 全開
await sleep(1500);
await remoteKey("Digit1"); // A 全開へ戻す
await sleep(1200);

capturing = false;
await capture;
await browser.close();

// --- 横並び合成して GIF 化 ---
mkdirSync(outDir, { recursive: true });
const frames = frameIndex;
// 各フレームを「出力（左）＋スマホ枠（右）」に合成。背景は SNS 映えする濃色。
const composedDir = mkdtempSync(join(tmpdir(), "browser-vj-composed-"));
const PAD = 24;
const GAP = 40;
const TOP = 56; // 上部のラベル帯
const canvasW = PAD + OUT_W + GAP + PHONE_W + PAD;
const outX = PAD;
const phoneX = PAD + OUT_W + GAP;
for (let i = 0; i < frames; i++) {
  const idx = String(i).padStart(4, "0");
  const o = join(frameDir, `o${idx}.png`);
  const p = join(frameDir, `p${idx}.png`);
  const out = join(composedDir, `c${idx}.png`);
  const outY = TOP + Math.round((CANVAS_H - TOP - OUT_H) / 2);
  const phoneY = TOP + Math.round((CANVAS_H - TOP - PHONE_H) / 2);
  // 背景 → 出力 → スマホ → ラベル2枚（上部）の順に重ねる。
  execFileSync("ffmpeg", [
    "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=#0d0d12:s=${canvasW}x${CANVAS_H}`,
    "-i", o, "-i", p, "-i", labelOut, "-i", labelPhone,
    "-filter_complex",
      `[0][1]overlay=${outX}:${outY}[a];` +
      `[a][2]overlay=${phoneX}:${phoneY}[b];` +
      `[b][3]overlay=${outX}:10[c];` +
      `[c][4]overlay=${phoneX}:10`,
    "-frames:v", "1", "-y", out,
  ]);
}

const palette = join(composedDir, "palette.png");
const inputPattern = join(composedDir, "c%04d.png");
const GIF_W = 720, GIF_COLORS = 128;
execFileSync("ffmpeg", [
  "-loglevel", "error", "-i", inputPattern,
  "-vf", `scale=${GIF_W}:-1:flags=lanczos,palettegen=max_colors=${GIF_COLORS}:stats_mode=diff`,
  "-y", palette,
]);
execFileSync("ffmpeg", [
  "-loglevel", "error", "-framerate", String(FPS),
  "-i", inputPattern, "-i", palette,
  "-lavfi", `scale=${GIF_W}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
  "-y", outGif,
]);

rmSync(frameDir, { recursive: true, force: true });
rmSync(composedDir, { recursive: true, force: true });
rmSync(assetDir, { recursive: true, force: true });
console.log(`生成: ${outGif}（${frames} フレーム）`);
