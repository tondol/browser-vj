import { defineConfig } from "vite";

declare const process: { env: Record<string, string | undefined> };

// GitHub Pages はリポジトリ名のサブパス（/<repo>/）で配信されるため、
// CI 上では GITHUB_REPOSITORY からその base を組み立てる。ローカルでは "/"。
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : "/";

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        output: "output.html",
      },
    },
  },
});
