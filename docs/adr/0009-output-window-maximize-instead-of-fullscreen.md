# ADR-0009: 出力ウィンドウを Fullscreen API ではなくウィンドウ最大化で全画面表示する

日付: 2026-06-13
ステータス: 採用

## コンテキスト

出力ウィンドウをフルスクリーンにした状態でコントローラ側のファイルダイアログを開くと、出力ウィンドウのフルスクリーンが解除され、映像が固まる（フリーズして見える）不具合があった。ADR-0008 で `<input>` 化を試したが解決せず、実機で観測ログを取って真因を特定した。

出力ウィンドウのコンソールで計測したログ（macOS / Chrome、出力をフルスクリーン化後にファイルダイアログを開く）:

```
fs=true  vis=visible  advancing=true  renderedFPS=30   ← 正常
fs=false vis=visible  advancing=true  renderedFPS=9    ← フルスクリーン解除
fs=false vis=hidden   advancing=true  renderedFPS=0    ← 別 Space に隠れ、描画停止
```

判明したこと:

- `requestFullscreen()` は macOS で**専用の仮想 Space** を作る
- コントローラ側でファイルダイアログ（OS ネイティブ）が開くと、メインの Space に切り替わり、出力のフルスクリーン Space は裏に隠れる（`vis=hidden`）
- 隠れたウィンドウはブラウザが描画を止める（`renderedFPS=0`）。**動画の再生自体は進んでいる**（`advancing=true`）が、画面に出ないため「フリーズ」に見える
- ADR-0005 の省電力凍結（再生停止）とは別物。これは描画とウィンドウ管理の問題

## 決定

出力ウィンドウのダブルクリックを、Fullscreen API ではなく**ウィンドウ自体の最大化**に変更する。

- `window.moveTo` / `resizeTo` で、ウィンドウがいるディスプレイの作業領域（`screen.availLeft/availTop/availWidth/availHeight`）いっぱいに広げる
- フルスクリーン相当の見た目は CSS（背景黒・カーソル非表示）で作る
- もう一度ダブルクリックすると元のサイズ・位置に戻す

## 理由

- Fullscreen API が専用 Space を作ることが問題の根なので、API を使わなければ Space 切り替えに巻き込まれず、隠れない＝描画も止まらない
- 出力ウィンドウは別ディスプレイ（プロジェクタ等）に置く運用が前提。外部ディスプレイのウィンドウを最大化すれば、ツールバーぶんを除きフルスクリーン相当の表示になり、実用上の差は小さい
- 実機で「最大化状態のままファイルダイアログを開ける」ことを確認済み

## 結果

- 真のフルスクリーン（メニューバーまで消える）ではなく、ブラウザのウィンドウ枠・ツールバーが残る場合がある
- `window.moveTo` / `resizeTo` は `window.open` で開いたウィンドウに対して有効。出力ウィンドウはこの方法で開いているため動作する
- マルチモニタでの座標は `screen.availLeft/availTop` に依存する（lib.dom 未収録のため [src/types/screen-ext.d.ts](../../src/types/screen-ext.d.ts) で型を補う）
