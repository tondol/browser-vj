import { defineConfig } from "vite";

declare const process: { env: Record<string, string | undefined> };

// GitHub Pages はリポジトリ名のサブパス（/<repo>/）で配信されるため、
// CI 上では GITHUB_REPOSITORY からその base を組み立てる。ローカルでは "/"。
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : "/";

// スマホリモコンは中継サーバ（bridge/server.mjs）が必要で、静的配信の
// GitHub Pages では動かない。Pages ビルド（CI）ではUI・接続ごと無効化する。
const remoteEnabled = !process.env.GITHUB_ACTIONS;

export default defineConfig({
  base,
  define: {
    __REMOTE_ENABLED__: JSON.stringify(remoteEnabled),
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        output: "output.html",
      },
    },
  },
});
