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

let markups = { buy: 0, sell: 0 };
let basePrices = { buy: 0, sell: 0 };

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
    markups.buy = saved.buy || 0;
    markups.sell = saved.sell || 0;
  } catch(e) { console.error('Failed to load markups.json'); }
}

function saveMarkups() {
  fs.writeFileSync(dataFile, JSON.stringify(markups));
}

const adminClients = new Set();
const sseClients = new Set();

function broadcastAdminState() {
  const payload = JSON.stringify({
    type: 'ADMIN_STATE',
    baseBuy: basePrices.buy,
    baseSell: basePrices.sell,
    buyMarkup: markups.buy,
    sellMarkup: markups.sell
  }) + '\n';
  for (const client of adminClients) {
    if (client.isAuthenticatedAdmin && !client.destroyed) {
      client.write(payload);
    }
  }
}

function broadcastMarkupToWeb() {
  const payloadJSON = JSON.stringify({ type: 'MARKUP_UPDATE', ...markups });
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
  res.write(`event: message\ndata: ${JSON.stringify({ type: 'MARKUP_UPDATE', ...markups })}\n\n`);
  req.on('close', () => sseClients.delete(res));
});

// C. Serve static files from Vite build (dist)
app.use(express.static(path.join(__dirname, 'dist')));

// D. SPA Routing Fallback
app.get('*', (req, res) => {
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
          } catch(e) {
            socket.write(JSON.stringify({ type: 'AUTH_FAIL', reason: '非对称加密解码失败，公钥不匹配' }) + '\n');
            socket.destroy();
          }
        } 
        else if (msg.type === 'SET_MARKUP' && socket.isAuthenticatedAdmin) {
          if (typeof msg.buy === 'number') markups.buy = msg.buy;
          if (typeof msg.sell === 'number') markups.sell = msg.sell;
          console.log(`[TCP Admin] Settings updated: Buy +${markups.buy}, Sell +${markups.sell}`);
          
          saveMarkups();
          
          broadcastAdminState();
          broadcastMarkupToWeb();
        }
      } catch (e) {
        console.error("Invalid TCP message format", e);
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
        const target = json.items.find(item => item.code === "JZJ_au");
        if (target) {
          basePrices.buy = parseFloat(target.bidprice);
          basePrices.sell = parseFloat(target.askprice);
          broadcastAdminState();
        }
      } catch (e) {}
    });
  }).on('error', () => {});
}, 500);
