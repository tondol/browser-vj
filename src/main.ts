import { CHANNEL_NAME, type DeckId, type VjMessage } from "./protocol";
import { Library, supportsFsAccess, type LibraryEntry } from "./library";

const NUDGE_FINE_MS = 100;
const NUDGE_COARSE_MS = 1000;
const FADER_STEP = 0.05;
const FADER_STEP_FINE = 0.01;
const SYNC_INTERVAL_MS = 500;

const channel = new BroadcastChannel(CHANNEL_NAME);
const post = (message: VjMessage) => channel.postMessage(message);

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

interface Deck {
  id: DeckId;
  video: HTMLVideoElement;
  nameLabel: HTMLElement;
  timeLabel: HTMLElement;
  seekBar: HTMLInputElement;
  playButton: HTMLButtonElement;
  url: string | null;
  fileName: string;
  // マスタークロック。video要素はブラウザの省電力で勝手に止まる・凍るため、
  // 配信する再生状態は常にここから導出し、videoはクロックに追従するプレビューとして扱う
  playing: boolean;
  loop: boolean;
  anchorMediaTime: number;
  anchorWallTime: number;
}

function createDeck(id: DeckId): Deck {
  const deck: Deck = {
    id,
    video: $(`video-${id}`),
    nameLabel: $(`name-${id}`),
    timeLabel: $(`time-${id}`),
    seekBar: $(`seek-${id}`),
    playButton: $(`btn-play-${id}`),
    url: null,
    fileName: "",
    playing: false,
    loop: true,
    anchorMediaTime: 0,
    anchorWallTime: 0,
  };
  deck.video.addEventListener("pause", () => {
    // ブラウザ都合の強制停止なら再開を試みる（クロックには影響しない）。
    // ループオフで終端に達した場合の停止はクロック側で扱う
    if (deck.playing && !deck.video.ended) void deck.video.play().catch(() => {});
  });
  deck.playButton.addEventListener("click", () => togglePlay(deck));
  const loopCheckbox = $<HTMLInputElement>(`loop-${id}`);
  loopCheckbox.addEventListener("change", () => {
    setLoop(deck, loopCheckbox.checked);
    loopCheckbox.blur();
  });
  deck.seekBar.addEventListener("input", () => {
    const ratio = Number(deck.seekBar.value) / 1000;
    seekTo(deck, ratio * (deck.video.duration || 0));
  });
  deck.seekBar.addEventListener("change", () => deck.seekBar.blur());
  return deck;
}

const deckA = createDeck("a");
const deckB = createDeck("b");
const decks = [deckA, deckB];

function currentDeckTime(deck: Deck): number {
  if (!deck.playing) return deck.anchorMediaTime;
  const elapsed = (Date.now() - deck.anchorWallTime) / 1000;
  const time = deck.anchorMediaTime + elapsed;
  const duration = deck.video.duration;
  if (!duration) return time;
  return deck.loop ? time % duration : Math.min(time, duration);
}

// ループオフ時、クロックが終端へ達したら停止状態に落とす
function stopAtEndIfNeeded(deck: Deck): void {
  const duration = deck.video.duration;
  if (!deck.playing || deck.loop || !duration) return;
  const elapsed = (Date.now() - deck.anchorWallTime) / 1000;
  if (deck.anchorMediaTime + elapsed < duration) return;
  stopPlayback(deck, duration);
}

function setLoop(deck: Deck, value: boolean): void {
  deck.anchorMediaTime = currentDeckTime(deck);
  deck.anchorWallTime = Date.now();
  deck.loop = value;
  deck.video.loop = value;
  post({ type: "loop", deck: deck.id, value });
}

// プレビューのvideoがクロックからずれていたら合わせる（ループ境界をまたぐ場合は補正しない）
function alignPreview(deck: Deck): void {
  const duration = deck.video.duration;
  if (!deck.url || !duration) return;
  const target = currentDeckTime(deck);
  const raw = Math.abs(deck.video.currentTime - target);
  const distance = Math.min(raw, duration - raw);
  const threshold = deck.playing ? 0.3 : 0.02;
  if (distance > threshold) deck.video.currentTime = target;
}

function startPlayback(deck: Deck): void {
  deck.anchorWallTime = Date.now();
  deck.playing = true;
  deck.playButton.textContent = "停止";
  void deck.video.play();
  post({ type: "play", deck: deck.id });
}

function stopPlayback(deck: Deck, atTime: number): void {
  deck.anchorMediaTime = atTime;
  deck.playing = false;
  deck.playButton.textContent = "再生";
  deck.video.pause();
  deck.video.currentTime = atTime;
  post({ type: "pause", deck: deck.id });
  post({ type: "seek", deck: deck.id, time: atTime });
}

function loadFile(deck: Deck, file: File): void {
  const oldUrl = deck.url;
  deck.url = URL.createObjectURL(file);
  deck.fileName = file.name;
  deck.video.src = deck.url;
  deck.nameLabel.textContent = file.name;
  deck.seekBar.disabled = false;
  deck.playButton.disabled = false;
  deck.anchorMediaTime = 0;
  post({ type: "load", deck: deck.id, url: deck.url, name: file.name });
  startPlayback(deck);
  if (oldUrl) {
    // ミラー側が新しいURLへ切り替えるまでの猶予をとってから解放する
    setTimeout(() => URL.revokeObjectURL(oldUrl), 5000);
  }
}

function togglePlay(deck: Deck): void {
  if (!deck.url) return;
  if (deck.playing) {
    stopPlayback(deck, currentDeckTime(deck));
    return;
  }
  const duration = deck.video.duration;
  if (duration && deck.anchorMediaTime >= duration) {
    // 終端で停止していたら頭出しして再生
    seekTo(deck, 0);
  }
  startPlayback(deck);
}

function seekTo(deck: Deck, time: number): void {
  if (!deck.url) return;
  const duration = deck.video.duration || 0;
  const clamped = Math.min(Math.max(time, 0), duration);
  deck.anchorMediaTime = clamped;
  deck.anchorWallTime = Date.now();
  deck.video.currentTime = clamped;
  post({ type: "seek", deck: deck.id, time: clamped });
}

function nudge(deck: Deck, ms: number): void {
  seekTo(deck, currentDeckTime(deck) + ms / 1000);
}

// --- フェーダー (0 = A, 1 = B) ---

const faderInput = $<HTMLInputElement>("fader");
const faderLabel = $<HTMLOutputElement>("fader-value");
let faderPosition = 0;

function setFader(value: number, updateInput = true): void {
  faderPosition = Math.min(Math.max(value, 0), 1);
  if (updateInput) faderInput.value = String(Math.round(faderPosition * 1000));
  const b = Math.round(faderPosition * 100);
  faderLabel.textContent = `A ${100 - b}% / B ${b}%`;
  post({ type: "fader", value: faderPosition });
}

faderInput.addEventListener("input", () =>
  setFader(Number(faderInput.value) / 1000, false),
);
faderInput.addEventListener("change", () => faderInput.blur());

// --- ファイル選択 ---

type FileSource = FileSystemFileHandle | File;

function isMp4(name: string): boolean {
  // "._" で始まるファイルはmacOSのAppleDoubleメタデータなので除外する
  return name.toLowerCase().endsWith(".mp4") && !name.startsWith("._");
}

function pickWithInput(setup: (input: HTMLInputElement) => void): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    setup(input);
    input.onchange = () => resolve([...(input.files ?? [])].filter((f) => isMp4(f.name)));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

async function pickVideoFiles(multiple: boolean): Promise<FileSource[]> {
  if (window.showOpenFilePicker) {
    try {
      return await window.showOpenFilePicker({
        multiple,
        types: [{ description: "動画", accept: { "video/mp4": [".mp4"] } }],
      });
    } catch {
      return [];
    }
  }
  return pickWithInput((input) => {
    input.accept = "video/mp4";
    input.multiple = multiple;
  });
}

async function pickFolderVideos(): Promise<FileSource[]> {
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker();
      const handles: FileSystemFileHandle[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind === "file" && isMp4(entry.name)) handles.push(entry);
      }
      return handles.sort((x, y) => x.name.localeCompare(y.name));
    } catch {
      return [];
    }
  }
  return pickWithInput((input) => {
    input.webkitdirectory = true;
  });
}

async function sourceToFile(source: FileSource): Promise<File> {
  return source instanceof File ? source : source.getFile();
}

$("btn-load-a").addEventListener("click", () => void loadFromPicker(deckA));
$("btn-load-b").addEventListener("click", () => void loadFromPicker(deckB));

async function loadFromPicker(deck: Deck): Promise<void> {
  const [source] = await pickVideoFiles(false);
  if (source) loadFile(deck, await sourceToFile(source));
}

// --- ライブラリ ---

const library = await Library.open();
const libraryList = $<HTMLUListElement>("library-list");
if (!supportsFsAccess) $("library-note").hidden = false;

// entry.id -> サムネ dataURL。再描画での再デコードを避けるためのキャッシュ。
const thumbnailCache = new Map<number, string>();

const THUMB_WIDTH = 320;
// この平均輝度（0-255）を下回るフレームは「黒つぶれ」とみなし次の候補を試す
const THUMB_MIN_BRIGHTNESS = 16;
// 動画長に対する候補位置（先頭はフェードイン等で暗いことが多いので避ける）
const THUMB_SEEK_RATIOS = [0.1, 0.3];

// File から動画の1フレームを抜いてサムネイルの dataURL を作る。
// 冒頭は黒みがちなので、複数候補位置を順に試し、黒つぶれなら次を採る。失敗時は null。
async function createThumbnail(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;

  const cleanup = () => {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  };

  try {
    await once(video, "loadeddata");
    const duration = video.duration || 0;
    const ratio = video.videoHeight / video.videoWidth || 0.5625;
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.round(THUMB_WIDTH * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    let lastDataUrl: string | null = null;
    for (const seekRatio of THUMB_SEEK_RATIOS) {
      video.currentTime = duration * seekRatio;
      await once(video, "seeked");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      lastDataUrl = canvas.toDataURL("image/jpeg", 0.7);
      if (averageBrightness(ctx, canvas) >= THUMB_MIN_BRIGHTNESS) break;
    }
    return lastDataUrl;
  } catch {
    return null;
  } finally {
    cleanup();
  }
}

function once(target: HTMLVideoElement, type: "loadeddata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(type, () => resolve(), { once: true });
    target.addEventListener("error", () => reject(new Error("video error")), { once: true });
  });
}

function averageBrightness(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): number {
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  // 16px ごとに間引いてサンプリング（RGB の単純平均で十分）
  const stride = 16 * 4;
  let count = 0;
  for (let i = 0; i < data.length; i += stride) {
    sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    count++;
  }
  return count ? sum / count : 0;
}

function entryTile(entry: LibraryEntry): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "entry-tile";

  const thumb = document.createElement("div");
  thumb.className = "entry-thumb";
  const removeButton = document.createElement("button");
  removeButton.className = "entry-remove";
  removeButton.textContent = "×";
  removeButton.title = "ライブラリから削除";
  removeButton.addEventListener("click", () => {
    thumbnailCache.delete(entry.id);
    void library.remove(entry.id).then(renderLibrary);
  });
  thumb.append(removeButton);

  const name = document.createElement("span");
  name.className = "entry-name";
  name.textContent = entry.name + (entry.persisted ? "" : "（保存なし）");
  name.title = entry.name;

  const actions = document.createElement("div");
  actions.className = "entry-actions";
  for (const deck of decks) {
    const button = document.createElement("button");
    button.textContent = `→ ${deck.id.toUpperCase()}`;
    button.addEventListener("click", () => void loadFromLibrary(entry, deck));
    actions.append(button);
  }

  li.append(thumb, name, actions);

  const cached = thumbnailCache.get(entry.id);
  if (cached) {
    thumb.style.backgroundImage = `url(${cached})`;
  } else {
    // サムネは権限プロンプトを出さずに取れる場合だけ生成し、後から差し込む。
    // 生成結果は entry.id でキャッシュし、再描画での再デコードを避ける。
    void library.getFileIfReady(entry).then(async (file) => {
      if (!file) return;
      const dataUrl = await createThumbnail(file);
      if (!dataUrl) return;
      thumbnailCache.set(entry.id, dataUrl);
      thumb.style.backgroundImage = `url(${dataUrl})`;
    });
  }

  return li;
}

async function loadFromLibrary(entry: LibraryEntry, deck: Deck): Promise<void> {
  const file = await library.getFile(entry);
  if (!file) {
    alert(`「${entry.name}」を読み込めませんでした（移動・削除された可能性があります）`);
    return;
  }
  loadFile(deck, file);
}

async function renderLibrary(): Promise<void> {
  const entries = await library.list();
  libraryList.replaceChildren(...entries.map(entryTile));
}

async function addToLibrary(sources: FileSource[]): Promise<void> {
  if (sources.length === 0) return; // 選択キャンセル時など、無駄な再描画を避ける
  for (const source of sources) await library.add(source);
  await renderLibrary();
}

$("btn-add-files").addEventListener("click", () => {
  void pickVideoFiles(true).then(addToLibrary);
});
$("btn-add-folder").addEventListener("click", () => {
  void pickFolderVideos().then(addToLibrary);
});
$("btn-clear-library").addEventListener("click", () => {
  if (!confirm("ライブラリを全て削除しますか？")) return;
  thumbnailCache.clear();
  void library.clear().then(renderLibrary);
});

void renderLibrary();

// --- ドラッグ＆ドロップ ---

function setupDropZone(
  element: HTMLElement,
  onDrop: (dataTransfer: DataTransfer) => void,
): void {
  element.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    element.classList.add("drag-over");
  });
  element.addEventListener("dragleave", (event) => {
    if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
    element.classList.remove("drag-over");
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    element.classList.remove("drag-over");
    if (event.dataTransfer) onDrop(event.dataTransfer);
  });
}

for (const deck of decks) {
  setupDropZone($(`deck-${deck.id}`), (dataTransfer) => {
    const file = [...dataTransfer.files].find((f) => isMp4(f.name));
    if (file) loadFile(deck, file);
  });
}

setupDropZone($("library"), (dataTransfer) => {
  // getAsFileSystemHandle / getAsFile はdropイベント中に同期的に呼ぶ必要がある
  const pending = [...dataTransfer.items]
    .filter((item) => item.kind === "file")
    .map((item) => {
      const file = item.getAsFile();
      const handle = item.getAsFileSystemHandle?.() ?? Promise.resolve(null);
      return handle.then((h) => h ?? file).catch(() => file);
    });
  void Promise.all(pending).then((handles) => {
    const sources = handles.filter(
      (h): h is FileSource =>
        h != null && (h instanceof File || h.kind === "file") && isMp4(h.name),
    );
    return addToLibrary(sources);
  });
});

// --- 出力 / プレビューウィンドウ ---

const outputUrl = `${import.meta.env.BASE_URL}output.html`;
$("btn-output").addEventListener("click", () => {
  window.open(outputUrl, "vj-output", "width=1280,height=720");
});
$("btn-preview").addEventListener("click", () => {
  window.open(outputUrl, "vj-preview", "width=640,height=360");
});

channel.onmessage = (event) => {
  const message = event.data as VjMessage;
  if (message.type === "key") {
    handleHotkey(message.code, message.shiftKey);
    return;
  }
  if (message.type !== "hello") return;
  for (const deck of decks) {
    if (!deck.url) continue;
    post({ type: "load", deck: deck.id, url: deck.url, name: deck.fileName });
    post({ type: "loop", deck: deck.id, value: deck.loop });
    post({ type: "seek", deck: deck.id, time: currentDeckTime(deck) });
    post({ type: deck.playing ? "play" : "pause", deck: deck.id });
  }
  post({ type: "fader", value: faderPosition });
};

setInterval(() => {
  for (const deck of decks) {
    if (!deck.url) continue;
    stopAtEndIfNeeded(deck);
    post({
      type: "sync",
      deck: deck.id,
      time: currentDeckTime(deck),
      playing: deck.playing,
      sentAt: Date.now(),
    });
  }
}, SYNC_INTERVAL_MS);

// --- 表示更新 ---

function formatTime(time: number): string {
  if (!Number.isFinite(time)) return "-:--.---";
  const minutes = Math.floor(time / 60);
  const seconds = time - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function tick(): void {
  for (const deck of decks) {
    stopAtEndIfNeeded(deck);
    alignPreview(deck);
    const { video } = deck;
    deck.timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    if (deck.url && video.duration && document.activeElement !== deck.seekBar) {
      deck.seekBar.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
  }
  requestAnimationFrame(tick);
}
tick();

// --- ホットキー ---

for (const button of document.querySelectorAll<HTMLButtonElement>(".nudge")) {
  button.addEventListener("click", () => {
    const deck = button.dataset.deck === "a" ? deckA : deckB;
    nudge(deck, Number(button.dataset.ms));
  });
}

document.addEventListener("click", (event) => {
  if (event.target instanceof HTMLButtonElement) event.target.blur();
});

function handleHotkey(code: string, shiftKey: boolean): boolean {
  const nudgeMs = shiftKey ? NUDGE_COARSE_MS : NUDGE_FINE_MS;
  const faderStep = shiftKey ? FADER_STEP_FINE : FADER_STEP;
  switch (code) {
    case "ArrowLeft":
      setFader(faderPosition - faderStep);
      break;
    case "ArrowRight":
      setFader(faderPosition + faderStep);
      break;
    case "Digit1":
      setFader(0);
      break;
    case "Digit2":
      setFader(1);
      break;
    case "KeyS":
      togglePlay(deckA);
      break;
    case "KeyL":
      togglePlay(deckB);
      break;
    case "KeyQ":
      nudge(deckA, -nudgeMs);
      break;
    case "KeyW":
      nudge(deckA, nudgeMs);
      break;
    case "KeyO":
      nudge(deckB, -nudgeMs);
      break;
    case "KeyP":
      nudge(deckB, nudgeMs);
      break;
    default:
      return false;
  }
  return true;
}

document.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  if (handleHotkey(event.code, event.shiftKey)) event.preventDefault();
});

setFader(0);
