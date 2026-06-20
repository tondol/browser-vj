export const CHANNEL_NAME = "browser-vj";

export type DeckId = "a" | "b";

export type VjMessage =
  | { type: "hello" }
  | { type: "key"; code: string; shiftKey: boolean }
  | { type: "load"; deck: DeckId; url: string; name: string }
  | { type: "play"; deck: DeckId }
  | { type: "pause"; deck: DeckId }
  | { type: "seek"; deck: DeckId; time: number }
  | { type: "loop"; deck: DeckId; value: boolean }
  | { type: "fader"; value: number }
  | {
      type: "sync";
      deck: DeckId;
      time: number;
      playing: boolean;
      sentAt: number;
    }
  // スマホリモコンからライブラリを操作するためのメッセージ（WSブリッジ経由）。
  // 動画の中身（blob）は端末を跨げないため、一覧は id/name/thumb のみを送り、
  // 実ロードは id を指定してPC側（main.ts）が行う。
  | { type: "library-request" }
  | { type: "library-list"; entries: LibraryRemoteEntry[] }
  | { type: "library-load"; id: number; deck: DeckId }
  // スマホ側で「いまどちらのデッキが出力されているか」を表示するための現在状態。
  // fader は 0=A / 1=B。再生中フラグと読み込み中の動画名も併せて送る。
  | { type: "status"; fader: number; decks: Record<DeckId, DeckStatus> };

// スマホ一覧表示用の軽量なライブラリエントリ（File は含めない）。
export interface LibraryRemoteEntry {
  id: number;
  name: string;
  thumb: string | null; // サムネイルの dataURL（未生成なら null）
}

export interface DeckStatus {
  name: string; // 読み込み中の動画名（未ロードなら空文字）
  playing: boolean;
  progress: number; // 再生位置の割合 0〜1（未ロード・長さ不明なら 0）
}
