const mineflayer = require('mineflayer');

const CONFIG = {
  server: { host: 'donutsmp.net', port: 25565, version: '1.20.4' },
  auth: { username: 'GambleBot', authType: 'microsoft' },
  reconnectDelay: 5000,
  winChance: 0.50,
  startingBalance: 1_000_000,
  cooldownMs: 10_000,
  globalRateLimit: 30,
  duplicateWindowMs: 5000,
  payConfirmTimeoutMs: 10_000,
  webhookUrl: '',
  webhookRateMs: 1000,
};

const SUFFIX_MAP = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
const PAYMENT_REGEX = /^(\.?\w{1,16}) paid you \$([0-9,.]+)([KkMmBb]?)\.$/;
const USERNAME_REGEX = /^\.?[a-zA-Z0-9_]{1,16}$/;

let balance = CONFIG.startingBalance;
let bot = null;
let processing = false;

const cooldowns = new Map();
const recentBets = new Map();
const gambleQueue = [];
const webhookQueue = [];
const globalHistory = [];

let webhookProcessing = false;

function parseAmount(numStr, suffix) {
  const num = parseFloat(numStr.replace(/,/g, ''));
  if (!Number.isFinite(num) || num <= 0) return 0;
  const mult = suffix ? SUFFIX_MAP[suffix.toLowerCase()] || 1 : 1;
  return num * mult;
}

function formatAmount(n) {
  if (n >= 1_000_000_000) return `${parseFloat((n / 1_000_000_000).toFixed(2))}b`;
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(2))}m`;
  if (n >= 1_000) return `${parseFloat((n / 1_000).toFixed(2))}k`;
  return String(parseFloat(n.toFixed(2)));
}

function randomDelay() {
  return 1000 + Math.random() * 2000;
}

function isDuplicate(username, amount) {
  const key = `${username}:${amount}`;
  const now = Date.now();
  if (recentBets.has(key) && now - recentBets.get(key) < CONFIG.duplicateWindowMs) return true;
  recentBets.set(key, now);
  return false;
}

function isOnCooldown(username) {
  const last = cooldowns.get(username);
  return last && Date.now() - last < CONFIG.cooldownMs;
}

function isRateLimited() {
  const now = Date.now();
  const cutoff = now - 60_000;
  while (globalHistory.length && globalHistory[0] < cutoff) globalHistory.shift();
  return globalHistory.length >= CONFIG.globalRateLimit;
}

function sendWebhook(embed) {
  if (!CONFIG.webhookUrl) return;
  webhookQueue.push(embed);
  drainWebhookQueue();
}

async function drainWebhookQueue() {
  if (webhookProcessing || !webhookQueue.length) return;
  webhookProcessing = true;
  while (webhookQueue.length) {
    const embed = webhookQueue.shift();
    try {
      await fetch(CONFIG.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
    } catch {}
    if (webhookQueue.length) await sleep(CONFIG.webhookRateMs);
  }
  webhookProcessing = false;
}

function logResult(player, amount, won, payout) {
  const result = won ? '\ud83d\udfe2 WON' : '\ud83d\udd34 LOST';
  console.log(`[${won ? 'WIN' : 'LOSS'}] ${player} bet $${formatAmount(amount)} — Balance: $${formatAmount(balance)}`);
  const desc = [
    `**Player:** Anonymous`,
    `**Amount:** $${won ? formatAmount(payout) : formatAmount(amount)}`,
    `**Result:** ${result}`,
  ];
  sendWebhook({
    color: won ? 0x00ff00 : 0xff0000,
    title: '\ud83c\udfb2 Gamble Result',
    description: desc.join('\n'),
    timestamp: new Date().toISOString(),
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function waitForPayConfirm(username, amount) {
  return new Promise(resolve => {
    const handler = (jsonMsg) => {
      const msg = jsonMsg.toString();
      if (msg.includes(username) && msg.toLowerCase().includes('paid')) {
        cleanup(true);
      }
    };
    const timeout = setTimeout(() => cleanup(false), CONFIG.payConfirmTimeoutMs);
    function cleanup(found) {
      clearTimeout(timeout);
      bot.removeListener('message', handler);
      resolve(found);
    }
    bot.on('message', handler);
  });
}

async function processQueue() {
  if (processing || !gambleQueue.length) return;
  processing = true;

  while (gambleQueue.length) {
    const { username, amount } = gambleQueue.shift();

    const won = Math.random() < CONFIG.winChance;
    const payout = amount * 2;

    if (won) {
      if (balance < payout) {
        console.log(`[SKIP] Insufficient funds for ${username}`);
        balance += amount;
      } else {
        await sleep(randomDelay());
        if (bot && bot.entity) {
          bot.chat(`/pay ${username} ${formatAmount(payout)}`);
          await waitForPayConfirm(username, payout);
          balance -= payout;
        }
        logResult(username, amount, true, payout);
      }
    } else {
      logResult(username, amount, false, 0);
    }

    globalHistory.push(Date.now());
    if (gambleQueue.length) await sleep(randomDelay());
  }

  processing = false;
}

function handlePayment(msg, position) {
  if (position === 'chat') return;

  const text = msg.toString();
  const match = text.match(PAYMENT_REGEX);
  if (!match) return;

  const [, rawUsername, numStr, suffix] = match;
  const username = rawUsername.replace(/[^a-zA-Z0-9_.]/g, '');

  if (!USERNAME_REGEX.test(username)) return;
  if (bot && username === bot.username) return;

  const amount = parseAmount(numStr, suffix);
  if (amount <= 0) return;

  if (isDuplicate(username, amount)) return;
  if (isOnCooldown(username)) return;
  if (isRateLimited()) return;

  cooldowns.set(username, Date.now());
  balance += amount;

  gambleQueue.push({ username, amount });
  processQueue();
}

function createBot() {
  bot = mineflayer.createBot({
    host: CONFIG.server.host,
    port: CONFIG.server.port,
    version: CONFIG.server.version,
    username: CONFIG.auth.username,
    auth: CONFIG.auth.authType,
  });

  bot.on('spawn', () => {
    console.log(`Connected as ${bot.username} — Balance: $${formatAmount(balance)}`);
  });

  bot.on('message', (jsonMsg, position) => {
    console.log(`[${position}] ${jsonMsg.toString()}`);
    handlePayment(jsonMsg, position);
  });

  bot.on('kicked', (reason) => {
    console.log(`Kicked: ${reason}`);
  });

  bot.on('end', (reason) => {
    console.log(`Disconnected. Reconnecting in ${CONFIG.reconnectDelay}ms...`);
    setTimeout(createBot, CONFIG.reconnectDelay);
  });

  bot.on('error', (err) => {
    console.log(`Error: ${err.message}`);
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, time] of recentBets) {
    if (now - time > CONFIG.duplicateWindowMs) recentBets.delete(key);
  }
  for (const [key, time] of cooldowns) {
    if (now - time > CONFIG.cooldownMs) cooldowns.delete(key);
  }
}, 30_000);

createBot();
