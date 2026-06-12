# テスト

ヘッドレス Chrome で実アプリを操作するエンドツーエンドのスモークテスト。方針は [ADR-0007](../docs/adr/0007-e2e-smoke-testing.md) を参照。

## 実行

```sh
npm test                 # dev サーバ起動 → 全テスト → 停止 を自動で行う
node test/run.mjs smoke  # 特定テストだけ実行
```

`npm test` は内部で `vite`（dev サーバ）を起動し、各テストを順に実行して終了時にサーバを停止する。

## 前提

- **Chrome**（Chromium 系）— 既定で macOS の Google Chrome を使う。別パスの場合は環境変数 `CHROME_PATH` で指定する
- **ffmpeg** — テスト用 mp4 を生成するために使う。無い場合、各テストは `SKIP` して正常終了する
- 依存 `puppeteer-core` は devDependency（ランタイム依存は増えない）

生成したテスト動画は OS の一時ディレクトリにキャッシュされ、再実行時は再利用される。

## 構成

- [run.mjs](run.mjs) — dev サーバの起動・待機・テスト実行・後始末を行うランナー
- [helpers.mjs](helpers.mjs) — ブラウザ起動・動画生成・drop 合成・assert などの共通処理
- [smoke.mjs](smoke.mjs) — コア機能（ロード・出力ミラー・フェーダー・ナッジ・ループ・ライブラリ・DnD）

## 環境変数

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `CHROME_PATH` | macOS の Google Chrome | Chrome 実行パス |
| `VJ_URL` | `http://localhost:5173` | 配信 URL（個別テストを既存サーバに向けて実行する場合） |
