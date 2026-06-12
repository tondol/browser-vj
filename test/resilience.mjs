// バックグラウンド省電力による強制停止への耐性テスト（ADR-0005 の検証）。
// コントローラの <video> が「pause イベントなしで currentTime だけ凍結」されても、
// 出力ウィンドウが区間ループせず実時間どおり進み続けることを確認する。
//
//   npm run dev &
//   node test/resilience.mjs

import {
  DEV_URL, VIDEO_DURATION_SEC, launch, collectErrors, dropFile,
  openOutputWindow, sleep, wrapDistance, createChecker, makeTestVideo,
} from "./helpers.mjs";

const red = makeTestVideo("red.mp4", "color=red:s=640x360:r=30");
if (!red) {
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

await dropFile(page, "#deck-a", red, "red.mp4");
await sleep(1200);

// コントローラの currentTime を getter 差し替えで凍結（pause イベントは出ない）
await page.evaluate(() => {
  const v = document.getElementById("video-a");
  const frozen = v.currentTime;
  Object.defineProperty(v, "currentTime", {
    configurable: true,
    get: () => frozen,
    set: () => {},
  });
});

// 出力を 3 秒間サンプリングして、逆行（区間ループ）が無いか確認
const samples = [];
for (let i = 0; i < 15; i++) {
  samples.push(await output.evaluate(() => document.getElementById("video-a").currentTime));
  await sleep(200);
}
let backwardJumps = 0;
for (let i = 1; i < samples.length; i++) {
  const delta = samples[i] - samples[i - 1];
  // ループ境界の折り返しは逆行とみなさない
  if (delta < -0.05 && samples[i - 1] < VIDEO_DURATION_SEC - 0.5) backwardJumps++;
}
check("no segment-looping while frozen", backwardJumps === 0, `backwardJumps=${backwardJumps}`);

const advanced = (samples.at(-1) - samples[0] + VIDEO_DURATION_SEC * 2) % VIDEO_DURATION_SEC;
check("output advances in real time", Math.abs(advanced - 2.8) < 0.4, `advanced=${advanced.toFixed(2)}s`);
check("output keeps playing while frozen", !(await output.evaluate(() => document.getElementById("video-a").paused)));

// 凍結解除 → コントローラのプレビューがクロックへ復帰
await page.evaluate(() => {
  const v = document.getElementById("video-a");
  delete v.currentTime;
});
await sleep(900);
const [ctrl, out] = await Promise.all([
  page.evaluate(() => document.getElementById("video-a").currentTime),
  output.evaluate(() => document.getElementById("video-a").currentTime),
]);
check("controller realigns after unfreeze", wrapDistance(ctrl, out) < 0.6, `ctrl=${ctrl.toFixed(3)} out=${out.toFixed(3)}`);

check("no JS errors", errors.length === 0, errors.join(" | "));

await browser.close();
process.exit(done() ? 0 : 1);
