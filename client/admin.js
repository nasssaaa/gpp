const net = require('net');
const readline = require('readline');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const configPath = path.join(process.cwd(), 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(`错误: 找不到配置文件 ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const pubFile = path.resolve(process.cwd(), config.pubKeyPath || 'server.pub');
const AUTH_SECRET = "GOLD_ADMIN_TOKEN_123";

if (!fs.existsSync(pubFile)) {
  console.error(`错误: 缺少公钥文件 (${pubFile})，无法验证身份！请在 config.json 检查 pubKeyPath 路径是否正确。`);
  process.exit(1);
}

let publicKey;
try {
  publicKey = fs.readFileSync(pubFile, 'utf8');
} catch (e) {
  console.error("错误: 读取公钥文件失败！");
  process.exit(1);
}

let encryptedToken;
try {
  encryptedToken = crypto.publicEncrypt(publicKey, Buffer.from(AUTH_SECRET)).toString('base64');
} catch (e) {
  console.error("错误: 密钥不正确或公钥格式无效！无法加密验证信息。");
  process.exit(1);
}

const tcpHost = config.tcpHost || '127.0.0.1';
const tcpPort = config.tcpPort || 8082;
const client = new net.Socket();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'Admin > '
});

let state = {
  baseBuy: 0,
  baseSell: 0,
  buyMarkup: 0,
  sellMarkup: 0
};
let errorMsg = '';
let isConnected = false;

function renderDashboard() {
  if (!isConnected) return;
  console.clear();
  console.log('=========================================');
  console.log('      TCP 金价调节终端 / MARKUP ADMIN        ');
  console.log('=========================================');

  const formatM = (m) => m >= 0 ? `+${m}` : `${m}`;
  const sellStrDisp = `${state.baseBuy.toFixed(2)}(${formatM(state.buyMarkup)})`;
  const buyStrDisp = `${state.baseSell.toFixed(2)}(${formatM(state.sellMarkup)})`;

  console.log(`\n  [ 回购 / Sell ] :  ${sellStrDisp}`);
  console.log(`  [ 销售 / Buy ]  :  ${buyStrDisp}\n`);
  console.log('=========================================');
  console.log('指令说明 (Commands):');
  console.log('  buy <数值>  (例如调节 销售/Buy: "buy 5.5" 或 "buy -2")');
  console.log('  sell <数值> (例如调节 回购/Sell: "sell 3.2")');
  console.log('  exit        (退出控制台)');
  console.log('=========================================');
  if (errorMsg) {
    console.log(`\n[!] ${errorMsg}`);
    errorMsg = '';
  } else {
    console.log('\n');
  }
}

let buffer = '';

client.connect(tcpPort, tcpHost, () => {
  client.write(JSON.stringify({ type: 'AUTH', token: encryptedToken }) + '\n');
});

client.on('data', (data) => {
  buffer += data.toString();
  const msgs = buffer.split('\n');
  buffer = msgs.pop();

  for (const msgString of msgs) {
    if (!msgString.trim()) continue;
    try {
      const msg = JSON.parse(msgString);

      if (msg.type === 'AUTH_SUCCESS') {
        isConnected = true;
        renderDashboard();
        rl.prompt();
      } else if (msg.type === 'AUTH_FAIL') {
        console.clear();
        console.error(`\n[!] 验证失败: 密钥不正确 (${msg.reason})\n`);
        process.exit(1);
      } else if (msg.type === 'ADMIN_STATE') {
        state.baseBuy = msg.baseBuy;
        state.baseSell = msg.baseSell;
        state.buyMarkup = msg.buyMarkup;
        state.sellMarkup = msg.sellMarkup;

        renderDashboard();
        rl.prompt(true);
      }
    } catch (e) { }
  }
});

client.on('close', () => {
  console.log('\n[!] 与服务器 TCP 连接断开。');
  process.exit(1);
});

client.on('error', (e) => {
  console.error(`\n[!] TCP 网络错误: 无法连接到服务器 ${tcpHost}:${tcpPort}。`, e.message);
  process.exit(1);
});

rl.on('line', (line) => {
  const input = line.trim().toLowerCase();

  if (input === 'exit' || input === 'quit') {
    console.clear();
    console.log('已退出 TCP 管理员控制台。\n');
    client.destroy();
    process.exit(0);
  }

  const parts = input.split(' ');
  if (parts.length === 2) {
    const cmdType = parts[0];
    const val = parseFloat(parts[1]);

    if (!isNaN(val) && (cmdType === 'buy' || cmdType === 'sell')) {
      // Mapping consumer perspective to internal keys: 
      // 'buy' cmd targets 'sell' markup
      // 'sell' cmd targets 'buy' markup
      const internalKey = cmdType === 'buy' ? 'sell' : 'buy';
      const payload = { type: 'SET_MARKUP', [internalKey]: val };
      client.write(JSON.stringify(payload) + '\n');
      return;
    } else {
      errorMsg = '格式错误! 请输入例如 "buy 5" 或 "sell -2"';
    }
  } else if (input !== '') {
    errorMsg = '未知指令 (输入 exit 退出)!';
  }

  renderDashboard();
  rl.prompt();
});
