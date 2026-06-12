# ADR-0006: GitHub Pages へのデプロイと base パス戦略

日付: 2026-06-12
ステータス: 採用

## コンテキスト

本アプリをインストール不要で試せるよう、ビルド済み静的サイトを公開したい。GitHub リポジトリで完結させたいので GitHub Pages が第一候補。Pages は `https://<user>.github.io/<repo>/` というリポジトリ名のサブパスで配信されるため、Vite の `base` を `/<repo>/` にしないとアセット参照（絶対パス）が壊れる。

論点:

1. `base` をどう与えるか（ハードコード / 環境変数）
2. 出力ウィンドウを開く `window.open("output.html")` がサブパス配信で壊れないか
3. デプロイ手段（Actions / 手動 gh-pages ブランチ）

## 決定

- **base は CI 環境変数から導出する。** `vite.config.ts` で `GITHUB_ACTIONS` と `GITHUB_REPOSITORY` を見て、CI 上のみ `/<repo>/` を設定する。ローカルの dev/preview は `/` のまま
- **`window.open` のパスは `import.meta.env.BASE_URL` で絶対パス化する。** Vite がビルド時に base を文字列リテラルとして埋め込むため、サブパス配信でも正しく解決される
- **デプロイは GitHub Actions 公式アクション**（`configure-pages` / `upload-pages-artifact` / `deploy-pages`）を使い、`main` への push で自動化する

## 理由

- base をハードコードするとリポジトリ名変更やフォークで壊れる。`GITHUB_REPOSITORY` 由来なら設定不要で追従する
- `window.open` に裸の相対パス `"output.html"` を渡すと、ブラウザは現在 URL からの相対で解決する。トップ（`/<repo>/`）では動くが、堅牢性のため `BASE_URL` で明示する
- `vite.config.ts` で `process.env` を参照するが、依存を増やさないため `@types/node` は入れず、当該ファイルを tsc の対象から外し（Vite が esbuild で処理する）`process` を最小 `declare` する

## 結果

- `import.meta.env.BASE_URL` を型安全に使うため [src/vite-env.d.ts](../../src/vite-env.d.ts) で `vite/client` を参照する
- リポジトリ側で **Pages の Source を「GitHub Actions」に設定**する手動操作が一度だけ必要（コードでは設定できない）
- 検証時の注意: `vite preview` はローカル環境で `.js` アセットを 404 にすることがある。GitHub Pages 相当の素の静的配信（例: `python3 -m http.server`）では正常に配信されるため、サブパス動作の最終確認は後者で行う
