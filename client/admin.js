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

const PRODUCT_KEYS = ['au', 'au9999', 'autd', 'ag', 'pt', 'pd'];
const PRODUCT_NAMES = {
  au: '黄金', au9999: '黄金9999', autd: '黄金T+D',
  ag: '白银', pt: '铂金', pd: '钯金'
};

const tcpHost = config.tcpHost || '127.0.0.1';
const tcpPort = config.tcpPort || 8082;
const client = new net.Socket();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'Admin > '
});

let state = {};
for (const key of PRODUCT_KEYS) {
  state[key] = { baseBuy: 0, baseSell: 0, buyMarkup: 0, sellMarkup: 0 };
}
let errorMsg = '';
let isConnected = false;

function renderDashboard() {
  if (!isConnected) return;
  console.clear();
  console.log('=================================================================');
  console.log('          TCP 贵金属调节终端 / MARKUP ADMIN                          ');
  console.log('=================================================================');

  const formatM = (m) => m >= 0 ? `+${m}` : `${m}`;

  console.log('');
  console.log('  商品           回购 (Sell)                  销售 (Buy)');
  console.log('  ─────────────────────────────────────────────────────────────');

  for (const key of PRODUCT_KEYS) {
    const s = state[key];
    const name = (PRODUCT_NAMES[key] || key).padEnd(10, '　');
    const sellStr = `${s.baseBuy.toFixed(2)}(${formatM(s.buyMarkup)})`.padEnd(24);
    const buyStr = `${s.baseSell.toFixed(2)}(${formatM(s.sellMarkup)})`;
    console.log(`  ${name}  ${sellStr}  ${buyStr}`);
  }

  console.log('');
  console.log('=================================================================');
  console.log('指令说明 (Commands):');
  console.log('  buy <商品> <数值>   (调节销售/Buy价格)');
  console.log('  sell <商品> <数值>  (调节回购/Sell价格)');
  console.log(`  商品代码: ${PRODUCT_KEYS.join(', ')}`);
  console.log('  示例: buy au 5.5 | sell ag -2 | buy pt 10');
  console.log('  exit               (退出控制台)');
  console.log('=================================================================');
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
      } else if (msg.type === 'ADMIN_STATE' && msg.products) {
        for (const key of PRODUCT_KEYS) {
          if (msg.products[key]) {
            state[key].baseBuy = msg.products[key].baseBuy;
            state[key].baseSell = msg.products[key].baseSell;
            state[key].buyMarkup = msg.products[key].buyMarkup;
            state[key].sellMarkup = msg.products[key].sellMarkup;
          }
        }
        renderDashboard();
        rl.prompt(true);
      } else if (msg.type === 'ERROR') {
        errorMsg = msg.reason || '服务器返回错误';
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

  const parts = input.split(/\s+/);
  if (parts.length === 3) {
    const cmdType = parts[0];
    const productKey = parts[1];
    const val = parseFloat(parts[2]);

    if (!isNaN(val) && (cmdType === 'buy' || cmdType === 'sell') && PRODUCT_KEYS.includes(productKey)) {
      // Mapping consumer perspective to internal keys: 
      // 'buy' cmd targets 'sell' markup
      // 'sell' cmd targets 'buy' markup
      const internalKey = cmdType === 'buy' ? 'sell' : 'buy';
      const payload = { type: 'SET_MARKUP', product: productKey, [internalKey]: val };
      client.write(JSON.stringify(payload) + '\n');
      return;
    } else if (!PRODUCT_KEYS.includes(productKey)) {
      errorMsg = `未知商品 "${productKey}"！有效商品: ${PRODUCT_KEYS.join(', ')}`;
    } else {
      errorMsg = '格式错误! 请输入例如 "buy au 5" 或 "sell ag -2"';
    }
  } else if (parts.length === 2) {
    // Backward hint: old format used, guide user
    errorMsg = '新格式需要指定商品！例如: "buy au 5" 或 "sell ag -2"';
  } else if (input !== '') {
    errorMsg = '未知指令 (输入 exit 退出)!';
  }

  renderDashboard();
  rl.prompt();
});
