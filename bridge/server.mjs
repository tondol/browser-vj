// スマホ（別端末）から PC の操作 UI を遠隔操作するための最小中継サーバ。
//
// 構成:
//   スマホ remote.html --(WebSocket)--> このサーバ --(WebSocket)--> PC の main.ts
// main.ts 側は受け取った {type:"key",...} を既存の handleHotkey に流すだけ。
// つまりこのサーバは「受け取ったメッセージを他の全クライアントへ素通しする」だけの
// 単純なブロードキャストハブ。認証なし・同一 LAN 前提の使い捨て構成。
//
// 起動: node bridge/server.mjs
// 環境変数 PORT で待受ポートを変更可能（既定 8787）。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { networkInterfaces } from "node:os";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";

const PORT = Number(process.env.PORT) || 8787;
const here = dirname(fileURLToPath(import.meta.url));

// このサーバが LAN 上で見えている IPv4 アドレス一覧（先頭を代表として使う）。
function localAddresses() {
  const result = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) result.push(addr.address);
    }
  }
  return result;
}

// スマホが開くリモコン URL。ブラウザは自分の LAN IP を取れないため、
// サーバが見た IP から組み立てて main 側へ渡す。
function remoteUrl() {
  const ip = localAddresses()[0] ?? "localhost";
  return `http://${ip}:${PORT}/`;
}

// remote.html をそのまま配信する（スマホは http://<PCのIP>:PORT/ を開く）。
const httpServer = createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/" || path === "/remote.html") {
    try {
      const html = await readFile(join(here, "remote.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500).end("remote.html not found");
    }
    return;
  }
  // main（別オリジンの vite dev）からリモコン URL と QR を取得するための情報。
  if (path === "/info") {
    try {
      const url = remoteUrl();
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ url, qr }));
    } catch {
      res.writeHead(500).end("qr generation failed");
    }
    return;
  }
  res.writeHead(404).end("not found");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  socket.on("message", (data, isBinary) => {
    // 送信元以外の全クライアントへ素通しする
    for (const client of wss.clients) {
      if (client !== socket && client.readyState === client.OPEN) {
        client.send(data, { binary: isBinary });
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`bridge server listening on :${PORT}`);
  const ips = localAddresses();
  if (ips.length === 0) {
    console.log(`  remote: http://localhost:${PORT}/`);
  } else {
    for (const ip of ips) console.log(`  remote (スマホで開く): http://${ip}:${PORT}/`);
  }
  console.log("  QR はコントローラのヘルプ画面にも表示されます");
});
