// コア機能のスモークテスト: ロード・出力ミラー・フェーダー・ナッジ・ループ・
// ライブラリ・ドラッグ&ドロップ・"._" 除外を一通り検証する。
//
// 事前に dev サーバ（npm run dev）を起動しておくこと。
//   npm run dev &
//   node test/smoke.mjs
//
// 環境変数:
//   VJ_URL       配信 URL（既定 http://localhost:5173）
//   CHROME_PATH  Chrome 実行パス（既定は macOS の Google Chrome）

import {
  DEV_URL, VIDEO_DURATION_SEC, launch, collectErrors, dropFile,
  openOutputWindow, sleep, wrapDistance, createChecker, makeTestVideo,
} from "./helpers.mjs";

const red = makeTestVideo("red.mp4", "color=red:s=640x360:r=30");
const blue = makeTestVideo("blue.mp4", "color=blue:s=640x360:r=30");
if (!red || !blue) {
  console.log("SKIP: ffmpeg が無いためテスト動画を生成できません");
  process.exit(0);
}

const { check, done } = createChecker();
const errors = [];
const browser = await launch();
const page = await browser.newPage();
collectErrors(page, "controller", errors);
await page.goto(DEV_URL, { waitUntil: "networkidle0" });

const output = await openOutputWindow(browser, page);
collectErrors(output, "output", errors);

// --- ロードと出力ミラー ---
await dropFile(page, "#deck-a", red, "red.mp4");
await sleep(1200);
const ctrlA = await page.evaluate(() => {
  const v = document.getElementById("video-a");
  return { name: document.getElementById("name-a").textContent, playing: !v.paused, time: v.currentTime };
});
check("deck A loads and plays", ctrlA.name === "red.mp4" && ctrlA.playing && ctrlA.time > 0, `t=${ctrlA.time.toFixed(2)}`);
const outA = await output.evaluate(() => {
  const v = document.getElementById("video-a");
  return { hasSrc: !!v.src, playing: !v.paused, time: v.currentTime };
});
check("video mirrors to output", outA.hasSrc && outA.playing && outA.time > 0, `t=${outA.time.toFixed(2)}`);
check("output in sync", wrapDistance(ctrlA.time, outA.time) < 0.6, `drift=${wrapDistance(ctrlA.time, outA.time).toFixed(3)}`);

// --- フェーダー（ホットキー） ---
await page.keyboard.press("2");
await sleep(300);
check("fader hotkey -> output opacity", (await output.evaluate(() => document.getElementById("video-b").style.opacity)) === "1");
check("fader label updates", (await page.evaluate(() => document.getElementById("fader-value").textContent)) === "A 0% / B 100%");

// --- 停止・ナッジ・再開（出力にも伝播） ---
await page.keyboard.press("s");
await sleep(500);
check("pause mirrors", (await page.evaluate(() => document.getElementById("video-a").paused)) && (await output.evaluate(() => document.getElementById("video-a").paused)));

const before = await page.evaluate(() => document.getElementById("video-a").currentTime);
await page.keyboard.press("w"); // +100ms
await sleep(300);
const after = await page.evaluate(() => document.getElementById("video-a").currentTime);
check("W nudges +100ms", Math.abs(after - before - 0.1) < 0.02, `${before.toFixed(3)} -> ${after.toFixed(3)}`);

await page.keyboard.down("Shift");
await page.keyboard.press("w"); // +1s
await page.keyboard.up("Shift");
await sleep(300);
const afterShift = await page.evaluate(() => document.getElementById("video-a").currentTime);
check("Shift+W nudges +1s", Math.abs(afterShift - after - 1) < 0.02, `${after.toFixed(3)} -> ${afterShift.toFixed(3)}`);

await page.keyboard.press("s");
await sleep(600);
check("resume mirrors", (await page.evaluate(() => !document.getElementById("video-a").paused)) && (await output.evaluate(() => !document.getElementById("video-a").paused)));

// --- ループ OFF -> 終端で停止、終端から再生で頭出し ---
await page.click("#loop-a");
await page.evaluate(() => {
  const seek = document.getElementById("seek-a");
  seek.value = "950";
  seek.dispatchEvent(new Event("input"));
});
await sleep(1500);
const end = await page.evaluate(() => {
  const v = document.getElementById("video-a");
  return { paused: v.paused, time: v.currentTime, duration: v.duration };
});
check("loop-off stops at end", end.paused && Math.abs(end.time - end.duration) < 0.1, `t=${end.time.toFixed(2)}`);
const outEnd = await output.evaluate(() => {
  const v = document.getElementById("video-a");
  return { paused: v.paused, time: v.currentTime };
});
check("output stops at end too", outEnd.paused && outEnd.time > VIDEO_DURATION_SEC - 0.2, `t=${outEnd.time.toFixed(2)}`);

await page.keyboard.press("s");
await sleep(800);
const replay = await page.evaluate(() => {
  const v = document.getElementById("video-a");
  return { playing: !v.paused, time: v.currentTime };
});
check("replay from start", replay.playing && replay.time < 1.5, `t=${replay.time.toFixed(2)}`);

// --- ループ ON に戻すと折り返す ---
await page.click("#loop-a");
await page.evaluate(() => {
  const seek = document.getElementById("seek-a");
  seek.value = "950";
  seek.dispatchEvent(new Event("input"));
});
await sleep(1500);
const looped = await page.evaluate(() => {
  const v = document.getElementById("video-a");
  return { playing: !v.paused, time: v.currentTime };
});
check("loop-on wraps", looped.playing && looped.time < 2, `t=${looped.time.toFixed(2)}`);

// --- ライブラリ: "._" 除外と全クリア ---
page.removeAllListeners("dialog");
let dialogResponses = [false, true]; // 1回目キャンセル / 2回目OK
page.on("dialog", (d) => void (dialogResponses.shift() ? d.accept() : d.dismiss()));

await dropFile(page, "#library", red, "._meta.mp4");
await dropFile(page, "#library", red, "clip1.mp4");
await dropFile(page, "#library", blue, "clip2.mp4");
await sleep(500);
const names = await page.evaluate(() => [...document.querySelectorAll("#library-list .entry-name")].map((e) => e.textContent));
check("'._' metadata file ignored", !names.some((n) => n.includes("._meta")), names.join(","));
check("normal files added", names.length === 2, `count=${names.length}`);

// タイルのサムネが生成され、background-image が入る
await sleep(800);
const thumbsReady = await page.evaluate(() =>
  [...document.querySelectorAll("#library-list .entry-thumb")].filter(
    (el) => el.style.backgroundImage.startsWith("url("),
  ).length,
);
check("thumbnails generated", thumbsReady === 2, `${thumbsReady}/2`);

// タイルの →B でデッキ B にロードできる
await page.evaluate(() => {
  const tiles = [...document.querySelectorAll("#library-list .entry-tile")];
  const buttons = tiles[0].querySelectorAll(".entry-actions button");
  buttons[buttons.length - 1].click(); // → B
});
await sleep(900);
const deckB = await page.evaluate(() => {
  const v = document.getElementById("video-b");
  return { name: document.getElementById("name-b").textContent, playing: !v.paused };
});
check("library tile loads deck B", deckB.name === "clip1.mp4" && deckB.playing, deckB.name);

await page.click("#btn-clear-library"); // キャンセル
await sleep(300);
check("clear cancel keeps library", (await page.evaluate(() => document.querySelectorAll("#library-list li").length)) === 2);
await page.click("#btn-clear-library"); // OK
await sleep(300);
check("clear empties library", (await page.evaluate(() => document.querySelectorAll("#library-list li").length)) === 0);

// --- 後から開いたプレビューウィンドウへの状態復元 ---
const preview = await openOutputWindow(browser, page, "btn-preview");
collectErrors(preview, "preview", errors);
await sleep(800);
const restored = await preview.evaluate(() => {
  const v = document.getElementById("video-a");
  return { hasSrc: !!v.src, playing: !v.paused };
});
check("late preview restores state", restored.hasSrc && restored.playing);

check("no JS errors", errors.length === 0, errors.join(" | "));

await browser.close();
process.exit(done() ? 0 : 1);
