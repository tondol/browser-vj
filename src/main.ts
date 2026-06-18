import { CHANNEL_NAME, type DeckId, type VjMessage } from "./protocol";
import { Library, type LibraryEntry } from "./library";

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
  playing: boolean;
  loop: boolean;
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
  };
  // ループオフで終端に達したら停止状態に落とす
  deck.video.addEventListener("ended", () => {
    if (deck.playing) {
      deck.playing = false;
      deck.playButton.textContent = "再生";
      post({ type: "pause", deck: deck.id });
    }
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

function setLoop(deck: Deck, value: boolean): void {
  deck.loop = value;
  deck.video.loop = value;
  previewVideos[deck.id].loop = value;
  post({ type: "loop", deck: deck.id, value });
}

function startPlayback(deck: Deck): void {
  deck.playing = true;
  deck.playButton.textContent = "停止";
  void deck.video.play();
  post({ type: "play", deck: deck.id });
}

function stopPlayback(deck: Deck): void {
  deck.playing = false;
  deck.playButton.textContent = "再生";
  deck.video.pause();
  post({ type: "pause", deck: deck.id });
}

function loadFile(deck: Deck, file: File): void {
  const oldUrl = deck.url;
  deck.url = URL.createObjectURL(file);
  deck.fileName = file.name;
  deck.video.src = deck.url;
  deck.nameLabel.textContent = file.name;
  deck.seekBar.disabled = false;
  deck.playButton.disabled = false;
  previewVideos[deck.id].src = deck.url;
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
    stopPlayback(deck);
    return;
  }
  const duration = deck.video.duration;
  if (duration && deck.video.currentTime >= duration) {
    seekTo(deck, 0); // 終端で停止していたら頭出しして再生
  }
  startPlayback(deck);
}

function seekTo(deck: Deck, time: number): void {
  if (!deck.url) return;
  const duration = deck.video.duration || 0;
  const clamped = Math.min(Math.max(time, 0), duration);
  deck.video.currentTime = clamped;
  post({ type: "seek", deck: deck.id, time: clamped });
}

function nudge(deck: Deck, ms: number): void {
  seekTo(deck, deck.video.currentTime + ms / 1000);
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
  previewVideos.b.style.opacity = String(faderPosition);
  post({ type: "fader", value: faderPosition });
}

faderInput.addEventListener("input", () =>
  setFader(Number(faderInput.value) / 1000, false),
);
faderInput.addEventListener("change", () => faderInput.blur());

// --- ファイル選択 ---

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

// ファイル選択は <input> 経由（File System Access API は使わない。ADR-0008）
function pickVideoFiles(multiple: boolean): Promise<File[]> {
  return pickWithInput((input) => {
    input.accept = "video/mp4";
    input.multiple = multiple;
  });
}

function pickFolderVideos(): Promise<File[]> {
  return pickWithInput((input) => {
    input.webkitdirectory = true;
  });
}

$("btn-load-a").addEventListener("click", () => void loadFromPicker(deckA));
$("btn-load-b").addEventListener("click", () => void loadFromPicker(deckB));

async function loadFromPicker(deck: Deck): Promise<void> {
  const [file] = await pickVideoFiles(false);
  if (file) loadFile(deck, file);
}

// --- ライブラリ ---

const library = new Library();
const libraryList = $<HTMLUListElement>("library-list");

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
    library.remove(entry.id);
    renderLibrary();
  });
  thumb.append(removeButton);

  const name = document.createElement("span");
  name.className = "entry-name";
  name.textContent = entry.name;
  name.title = entry.name;

  const actions = document.createElement("div");
  actions.className = "entry-actions";
  for (const deck of decks) {
    const button = document.createElement("button");
    button.textContent = `→ ${deck.id.toUpperCase()}`;
    button.addEventListener("click", () => loadFromLibrary(entry, deck));
    actions.append(button);
  }

  li.append(thumb, name, actions);

  const cached = thumbnailCache.get(entry.id);
  if (cached) {
    thumb.style.backgroundImage = `url(${cached})`;
  } else {
    // サムネを生成して後から差し込み、entry.id でキャッシュして再デコードを避ける
    void createThumbnail(entry.file).then((dataUrl) => {
      if (!dataUrl) return;
      thumbnailCache.set(entry.id, dataUrl);
      thumb.style.backgroundImage = `url(${dataUrl})`;
    });
  }

  return li;
}

function loadFromLibrary(entry: LibraryEntry, deck: Deck): void {
  loadFile(deck, entry.file);
}

function renderLibrary(): void {
  libraryList.replaceChildren(...library.list().map(entryTile));
}

interface LibraryItem {
  file: File;
  path: string; // ソート用のフルパス
}

function addToLibrary(items: LibraryItem[]): void {
  if (items.length === 0) return; // 選択キャンセル時など、無駄な再描画を避ける
  for (const item of items) library.add(item.file, item.path);
  renderLibrary();
}

// <input> 経由（ファイル / フォルダ追加）。フォルダ追加では webkitRelativePath が
// "dir/sub/clip.mp4" 形式で取れる。単体ファイルでは空なので name で代用する。
function itemsFromInput(files: File[]): LibraryItem[] {
  return files.map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

$("btn-add-files").addEventListener("click", () => {
  void pickVideoFiles(true).then((files) => addToLibrary(itemsFromInput(files)));
});
$("btn-add-folder").addEventListener("click", () => {
  void pickFolderVideos().then((files) => addToLibrary(itemsFromInput(files)));
});
$("btn-clear-library").addEventListener("click", () => {
  if (!confirm("ライブラリを全て削除しますか？")) return;
  thumbnailCache.clear();
  library.clear();
  renderLibrary();
});

renderLibrary();

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

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

// ドロップされた entry（ファイル / フォルダ）を再帰的にたどり、mp4 を集める。
// path は entry.fullPath（"/dir/sub/clip.mp4"）。File.webkitRelativePath は
// この経路では空になるため、ソート用パスは fullPath から取る。
async function collectMp4Files(
  entries: (FileSystemEntry | null)[],
): Promise<LibraryItem[]> {
  const items: LibraryItem[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isFile) {
      const file = await entryFile(entry as FileSystemFileEntry);
      if (isMp4(file.name)) items.push({ file, path: entry.fullPath });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries は1回で全件返るとは限らないので空になるまで繰り返す
      const children: FileSystemEntry[] = [];
      for (;;) {
        const batch = await readDirEntries(reader);
        if (batch.length === 0) break;
        children.push(...batch);
      }
      items.push(...(await collectMp4Files(children)));
    }
  }
  return items;
}

setupDropZone($("library"), (dataTransfer) => {
  // webkitGetAsEntry は drop イベント中に同期的に呼ぶ必要がある。
  // 取れればフォルダも展開できる。取れない環境では files へフォールバック。
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  if (entries.some((e) => e !== null)) {
    void collectMp4Files(entries).then((items) => addToLibrary(items));
  } else {
    addToLibrary(itemsFromInput([...dataTransfer.files].filter((f) => isMp4(f.name))));
  }
});

// --- 出力ウィンドウ ---

const outputUrl = `${import.meta.env.BASE_URL}output.html`;
$("btn-output").addEventListener("click", () => {
  window.open(outputUrl, "vj-output", "width=1280,height=720");
});

// --- 埋め込みプレビュー ---
// 出力ウィンドウと同じ「<video>2枚をopacityで重ねる」合成をコントローラ内で再現する。
// 同一ウィンドウ内なので BroadcastChannel を介さず、デッキ動画へ直接追従させる。
const previewVideos: Record<DeckId, HTMLVideoElement> = {
  a: $("preview-a"),
  b: $("preview-b"),
};
previewVideos.b.style.opacity = "0";

function syncPreview(): void {
  for (const deck of decks) {
    const pv = previewVideos[deck.id];
    if (!deck.url) continue;
    // ズレたときだけ合わせ、毎フレームの代入で再生を乱さないようにする
    if (Math.abs(pv.currentTime - deck.video.currentTime) > 0.1) {
      pv.currentTime = deck.video.currentTime;
    }
    if (deck.playing && pv.paused) void pv.play();
    if (!deck.playing && !pv.paused) pv.pause();
  }
}

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
    post({ type: "seek", deck: deck.id, time: deck.video.currentTime });
    post({ type: deck.playing ? "play" : "pause", deck: deck.id });
  }
  post({ type: "fader", value: faderPosition });
};

setInterval(() => {
  for (const deck of decks) {
    if (!deck.url) continue;
    post({
      type: "sync",
      deck: deck.id,
      time: deck.video.currentTime,
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
    const { video } = deck;
    deck.timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    if (deck.url && video.duration && document.activeElement !== deck.seekBar) {
      deck.seekBar.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
  }
  syncPreview();
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
