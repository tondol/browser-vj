// Screen の availLeft/availTop は一部ブラウザの拡張で lib.dom に未収録。
// マルチモニタでウィンドウがいるディスプレイの原点を得るのに使う。
interface Screen {
  readonly availLeft?: number;
  readonly availTop?: number;
}
