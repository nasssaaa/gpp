import { WebSocketServer } from 'ws';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const port = config.wsPort || 8080;
const wss = new WebSocketServer({ port });

let markups = { buy: 0, sell: 0 };
let basePrices = { buy: 0, sell: 0 };

const pubFile = 'server.pub';
const keyFile = 'server.key';

// Auto-generate keys in current directory natively
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

function broadcastAdminState() {
  const payload = JSON.stringify({
    type: 'ADMIN_STATE',
    baseBuy: basePrices.buy,
    baseSell: basePrices.sell,
    buyMarkup: markups.buy,
    sellMarkup: markups.sell
  });
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.isAuthenticatedAdmin) {
      client.send(payload);
    }
  });
}

function broadcastMarkupToWeb() {
  const payload = JSON.stringify({ type: 'MARKUP_UPDATE', ...markups });
  wss.clients.forEach(client => {
    if (client.readyState === 1 && !client.isAuthenticatedAdmin) {
      client.send(payload);
    }
  });
}

wss.on('connection', function connection(ws) {
  ws.isAuthenticatedAdmin = false;
  ws.send(JSON.stringify({ type: 'MARKUP_UPDATE', ...markups }));

  ws.on('message', function message(data) {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'AUTH') {
        try {
          const decrypted = crypto.privateDecrypt(privateKey, Buffer.from(msg.token, 'base64')).toString();
          if (decrypted === AUTH_SECRET) {
            ws.isAuthenticatedAdmin = true;
            ws.send(JSON.stringify({ type: 'AUTH_SUCCESS' }));
            broadcastAdminState();
          } else {
            ws.send(JSON.stringify({ type: 'AUTH_FAIL', reason: '密钥不正确' }));
            ws.close();
          }
        } catch(e) {
          ws.send(JSON.stringify({ type: 'AUTH_FAIL', reason: '非对称加密解码失败，公钥不匹配' }));
          ws.close();
        }
      } 
      else if (msg.type === 'SET_MARKUP' && ws.isAuthenticatedAdmin) {
        if (typeof msg.buy === 'number') markups.buy = msg.buy;
        if (typeof msg.sell === 'number') markups.sell = msg.sell;
        
        console.log(`[Admin] Settings updated: Buy +${markups.buy}, Sell +${markups.sell}`);
        
        broadcastAdminState();
        broadcastMarkupToWeb();
      }
    } catch (e) {
      console.error("Invalid message format", e);
    }
  });
});

console.log(`WebSocket secure server running on port ${port}`);
