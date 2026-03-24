import net from 'net';
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const tcpPort = config.tcpPort || 8082;
const httpPort = config.ssePort || 8081;

// Product definitions
const PRODUCTS = {
  au:     { name: '黄金',     code: 'JZJ_au' },
  au9999: { name: '黄金9999', code: 'Au99.99' },
  autd:   { name: '黄金T+D',  code: 'Au(T+D)' },
  ag:     { name: '白银',     code: 'JZJ_ag' },
  pt:     { name: '铂金',     code: 'JZJ_pt' },
  pd:     { name: '钯金',     code: 'JZJ_pd' },
};

const PRODUCT_KEYS = Object.keys(PRODUCTS);

// Per-product markups and base prices
let markups = {};
let basePrices = {};
for (const key of PRODUCT_KEYS) {
  markups[key] = { buy: 0, sell: 0 };
  basePrices[key] = { buy: 0, sell: 0 };
}

const pubFile = 'server.pub';
const keyFile = 'server.key';

// Auto-generate keys in current directory
if (!fs.existsSync(pubFile) || !fs.existsSync(keyFile)) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  fs.writeFileSync(pubFile, publicKey);
  fs.writeFileSync(keyFile, privateKey);
}

const privateKey = fs.readFileSync(keyFile, 'utf8');
const AUTH_SECRET = "GOLD_ADMIN_TOKEN_123";

// Restoring saved markups on boot to persist through crashes/restarts
const dataFile = 'markups.json';
if (fs.existsSync(dataFile)) {
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    // Support new per-product format
    for (const key of PRODUCT_KEYS) {
      if (saved[key]) {
        markups[key].buy = saved[key].buy || 0;
        markups[key].sell = saved[key].sell || 0;
      }
    }
    // Backward compatibility: migrate old {buy, sell} format to 'au'
    if (typeof saved.buy === 'number' && !saved.au) {
      markups.au.buy = saved.buy;
      markups.au.sell = saved.sell || 0;
    }
  } catch (e) { console.error('Failed to load markups.json'); }
}

function saveMarkups() {
  fs.writeFileSync(dataFile, JSON.stringify(markups));
}

const adminClients = new Set();
const sseClients = new Set();

function broadcastAdminState() {
  const products = {};
  for (const key of PRODUCT_KEYS) {
    products[key] = {
      name: PRODUCTS[key].name,
      baseBuy: basePrices[key].buy,
      baseSell: basePrices[key].sell,
      buyMarkup: markups[key].buy,
      sellMarkup: markups[key].sell,
    };
  }
  const payload = JSON.stringify({ type: 'ADMIN_STATE', products }) + '\n';
  for (const client of adminClients) {
    if (client.isAuthenticatedAdmin && !client.destroyed) {
      client.write(payload);
    }
  }
}

function broadcastMarkupToWeb() {
  const payloadJSON = JSON.stringify({ type: 'MARKUP_UPDATE', markups });
  const streamData = `event: message\ndata: ${payloadJSON}\n\n`;
  for (const res of sseClients) {
    res.write(streamData);
  }
}

// 1. HTTP Server for Browser SSE Stream + Static Files + API Proxy
const app = express();

// A. Proxy /api requests
app.use('/api', createProxyMiddleware({
  target: 'https://i.jzj9999.com',
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    proxyReq.setHeader('Referer', 'https://i.jzj9999.com/');
    proxyReq.setHeader('Host', 'i.jzj9999.com');
  }
}));

// B. SSE Subscription Endpoint
app.get('/events', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  sseClients.add(res);
  res.write(`event: message\ndata: ${JSON.stringify({ type: 'MARKUP_UPDATE', markups })}\n\n`);
  req.on('close', () => sseClients.delete(res));
});

// C. Serve static files from Vite build (dist)
app.use(express.static(path.join(__dirname, 'dist')));

// D. SPA Routing Fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const httpServer = http.createServer(app);
httpServer.listen(httpPort, () => console.log(`HTTP Server (Static + SSE + Proxy) running on port ${httpPort}`));

// 2. Pure TCP Server for Admin CLI
const tcpServer = net.createServer((socket) => {
  socket.isAuthenticatedAdmin = false;
  socket.buffer = '';

  socket.on('data', (data) => {
    socket.buffer += data.toString();
    const msgs = socket.buffer.split('\n');
    socket.buffer = msgs.pop();

    for (const msgString of msgs) {
      if (!msgString.trim()) continue;
      try {
        const msg = JSON.parse(msgString);

        if (msg.type === 'AUTH') {
          try {
            const decrypted = crypto.privateDecrypt(privateKey, Buffer.from(msg.token, 'base64')).toString();
            if (decrypted === AUTH_SECRET) {
              socket.isAuthenticatedAdmin = true;
              adminClients.add(socket);
              socket.write(JSON.stringify({ type: 'AUTH_SUCCESS' }) + '\n');
              broadcastAdminState();
            } else {
              socket.write(JSON.stringify({ type: 'AUTH_FAIL', reason: '密钥不正确' }) + '\n');
              socket.destroy();
            }
          } catch (e) {
            socket.write(JSON.stringify({ type: 'AUTH_FAIL', reason: '非对称加密解码失败，公钥不匹配' }) + '\n');
            socket.destroy();
          }
        }
        else if (msg.type === 'SET_MARKUP' && socket.isAuthenticatedAdmin) {
          const productKey = msg.product;
          if (!productKey || !PRODUCT_KEYS.includes(productKey)) {
            socket.write(JSON.stringify({ type: 'ERROR', reason: `无效商品: ${productKey}，有效值: ${PRODUCT_KEYS.join(', ')}` }) + '\n');
            continue;
          }
          if (typeof msg.buy === 'number') markups[productKey].buy = msg.buy;
          if (typeof msg.sell === 'number') markups[productKey].sell = msg.sell;
          console.log(`[TCP Admin] ${PRODUCTS[productKey].name} settings updated: Buy +${markups[productKey].buy}, Sell +${markups[productKey].sell}`);

          saveMarkups();

          broadcastAdminState();
          broadcastMarkupToWeb();
        }
      } catch (e) {
        socket.destroy();
      }
    }
  });

  socket.on('close', () => adminClients.delete(socket));
  socket.on('error', () => adminClients.delete(socket));
});
tcpServer.listen(tcpPort, () => console.log(`TCP Native Server (Admin API) running on port ${tcpPort}`));

// Poll the JZJ API
setInterval(() => {
  https.get('https://i.jzj9999.com/res/quote/pq.json', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        for (const key of PRODUCT_KEYS) {
          const target = json.items.find(item => item.code === PRODUCTS[key].code);
          if (target) {
            basePrices[key].buy = parseFloat(target.bidprice);
            basePrices[key].sell = parseFloat(target.askprice);
          }
        }
        broadcastAdminState();
      } catch (e) { }
    });
  }).on('error', () => { });
}, 500);
