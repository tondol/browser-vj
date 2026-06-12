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
    };
