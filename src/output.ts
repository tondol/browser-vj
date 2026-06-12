import { CHANNEL_NAME, type DeckId, type VjMessage } from "./protocol";

const DRIFT_HARD_SEEK_SEC = 0.5;
const DRIFT_CHASE_SEC = 0.02;
const DRIFT_PAUSED_SEC = 0.05;
const CHASE_RATE = 0.05;

const channel = new BroadcastChannel(CHANNEL_NAME);

const videos: Record<DeckId, HTMLVideoElement> = {
  a: document.getElementById("video-a") as HTMLVideoElement,
  b: document.getElementById("video-b") as HTMLVideoElement,
};
videos.b.style.opacity = "0";

function applySync(message: Extract<VjMessage, { type: "sync" }>): void {
  const video = videos[message.deck];
  if (!video.src) return;
  // ループオフで終端に達して自然停止した場合、コントローラの停止検知より
  // 先にsyncが来てもplay()で頭出しされないようにする
  if (video.ended && !video.loop && message.playing) return;
  if (message.playing && video.paused) void video.play();
  if (!message.playing && !video.paused) video.pause();
  const elapsed = message.playing ? (Date.now() - message.sentAt) / 1000 : 0;
  const drift = video.currentTime - (message.time + elapsed);
  const hardLimit = message.playing ? DRIFT_HARD_SEEK_SEC : DRIFT_PAUSED_SEC;
  if (Math.abs(drift) > hardLimit) {
    video.currentTime = message.time + elapsed;
    video.playbackRate = 1;
  } else if (message.playing && Math.abs(drift) > DRIFT_CHASE_SEC) {
    // 小さいズレはシークせず再生速度の微調整で滑らかに追従する
    video.playbackRate = drift > 0 ? 1 - CHASE_RATE : 1 + CHASE_RATE;
  } else {
    video.playbackRate = 1;
  }
}

channel.onmessage = (event) => {
  const message = event.data as VjMessage;
  switch (message.type) {
    case "load":
      videos[message.deck].src = message.url;
      break;
    case "play":
      void videos[message.deck].play();
      break;
    case "pause":
      videos[message.deck].pause();
      break;
    case "seek":
      videos[message.deck].currentTime = message.time;
      break;
    case "loop":
      videos[message.deck].loop = message.value;
      break;
    case "fader":
      videos.b.style.opacity = String(message.value);
      break;
    case "sync":
      applySync(message);
      break;
  }
};

channel.postMessage({ type: "hello" } satisfies VjMessage);

// 出力ウィンドウにフォーカスがあってもホットキーが効くようコントローラへ転送する
document.addEventListener("keydown", (event) => {
  channel.postMessage({
    type: "key",
    code: event.code,
    shiftKey: event.shiftKey,
  } satisfies VjMessage);
});

// Fullscreen API は専用 Space を作り、別ウィンドウのファイルダイアログ等で
// Space が切り替わると裏に隠れて描画が止まる（ADR-0009）。代わりに、ウィンドウ
// 自体を表示中のディスプレイいっぱいに広げてフルスクリーン相当の見た目にする。
let maximized = false;
let restoreRect: { x: number; y: number; w: number; h: number } | null = null;

function maximizeWindow(): void {
  restoreRect = {
    x: window.screenX,
    y: window.screenY,
    w: window.outerWidth,
    h: window.outerHeight,
  };
  // ウィンドウがいるディスプレイの作業領域に合わせる（マルチモニタ対応）
  const left = window.screen.availLeft ?? 0;
  const top = window.screen.availTop ?? 0;
  window.moveTo(left, top);
  window.resizeTo(window.screen.availWidth, window.screen.availHeight);
  document.body.classList.add("maximized");
  maximized = true;
}

function restoreWindow(): void {
  if (restoreRect) {
    window.moveTo(restoreRect.x, restoreRect.y);
    window.resizeTo(restoreRect.w, restoreRect.h);
  }
  document.body.classList.remove("maximized");
  maximized = false;
}

document.addEventListener("dblclick", () => {
  if (maximized) restoreWindow();
  else maximizeWindow();
});

setTimeout(() => {
  document.getElementById("hint")?.style.setProperty("opacity", "0");
}, 5000);
