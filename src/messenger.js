// messenger.js — inbound message pipeline with interactive buttons.
import { col, saveSettings, getSettings } from './db.js';
import { isAdminNumber, normalizeNumber } from './config.js';
import { handleSales, detectEscalation } from './flows/sales.js';
import { handleEscalation, isPaused } from './flows/escalation.js';
import { handleAdmin } from './admin.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const seenIds = new Set();
const SEEN_MAX = 1000;
function hasSeen(id) {
  if (!id) return false;
  if (seenIds.has(id)) return true;
  seenIds.add(id);
  if (seenIds.size > SEEN_MAX) {
    const it = seenIds.values();
    for (let i = 0; i < 200; i++) seenIds.delete(it.next().value);
  }
  return false;
}

function numSet(csv) {
  return new Set(String(csv || '').split(',').map((x) => x.trim()).filter(Boolean).map(normalizeNumber));
}

async function notifyWebhook(settings, payload) {
  const url = settings.notifyWebhookUrl;
  if (!url) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (e) {
    logger.error({ err: e.message }, 'webhook notify failed');
  }
}

async function handleFromMeCommand(sock, key, message, settings) {
  const text = (message?.conversation || message?.extendedTextMessage?.text || '').trim();
  const lower = text.toLowerCase();
  const remoteJid = key.remoteJid;
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) return false;
  const customerNumber = normalizeNumber(remoteJid);
  const isStop = /^[.\/]?stop\b/.test(lower) && !/botanist|stopover/.test(lower);
  const isStart = /^[.\/]?start\b/.test(lower) && !/starter|restart/.test(lower);
  if (isStop) {
    const s = await getSettings();
    const set = numSet(s.pausedNumbers);
    set.add(customerNumber);
    await saveSettings({ pausedNumbers: [...set].join(',') });
    await sock.sendMessage(remoteJid, { text: '⏸️ Is chat ke liye auto-reply band kar diya. ".start" se wapas chalu hoga.' });
    return true;
  }
  if (isStart) {
    const s = await getSettings();
    const set = numSet(s.pausedNumbers);
    set.delete(customerNumber);
    await saveSettings({ pausedNumbers: [...set].join(',') });
    await sock.sendMessage(remoteJid, { text: '▶️ Is chat ke liye auto-reply chalu kar diya.' });
    return true;
  }
  return false;
}

async function sendButtons(sock, remoteJid, text, footer, buttons) {
  try {
    await sock.sendMessage(remoteJid, { text, footer, buttons, headerType: 1 });
  } catch (e) {
    logger.warn({ err: e.message }, 'buttons send failed, fallback to text');
    await sock.sendMessage(remoteJid, { text });
  }
}

async function sendGreeting(sock, remoteJid, settings, lang) {
  const isHindi = lang === 'hindi';
  const text = isHindi
    ? '🙏 नमस्ते! *' + (settings.businessName || 'हमारी दुकान') + '* में आपका स्वागत है!\n\nनीचे दिए बटन से चुनिए कि आपको क्या चाहिए 👇'
    : '🙏 Namaste! Welcome to *' + (settings.businessName || 'our store') + '*!\n\nChoose what you need from the buttons below 👇';
  await sendButtons(sock, remoteJid, text, isHindi ? 'बटन दबाइए या सीधे मैसेज कीजिए' : 'Tap a button or just type your message', [
    { buttonId: 'id:catalog', buttonText: { displayText: isHindi ? '🛒 प्रोडक्ट्स देखें' : '🛒 Browse Products' }, type: 1 },
    { buttonId: 'id:language', buttonText: { displayText: isHindi ? '🌐 भाषा चुनें' : '🌐 Select Language' }, type: 1 },
    { buttonId: 'id:owner', buttonText: { displayText: isHindi ? '📞 Owner से बात' : '📞 Talk to Owner' }, type: 1 },
  ]);
}

async function sendLanguageMenu(sock, remoteJid) {
  await sendButtons(sock, remoteJid, '🌐 Choose your language / अपनी भाषा चुनिए:', 'Select a language', [
    { buttonId: 'lang:hindi', buttonText: { displayText: 'हिंदी' }, type: 1 },
    { buttonId: 'lang:english', buttonText: { displayText: 'English' }, type: 1 },
  ]);
}

async function sendCatalogMenu(sock, remoteJid, lang) {
  const isHindi = lang === 'hindi';
  await sendButtons(sock, remoteJid, isHindi ? '🛒 आपको किस category का सामान चाहिए?' : '🛒 Which category do you want?', isHindi ? 'चुनिए' : 'Choose one', [
    { buttonId: 'cat:laptop', buttonText: { displayText: '💻 Laptop/Computer' }, type: 1 },
    { buttonId: 'cat:gaming', buttonText: { displayText: '🎮 Gaming PC' }, type: 1 },
    { buttonId: 'cat:accessories', buttonText: { displayText: '🔌 Accessories' }, type: 1 },
  ]);
}

export async function handleInbound(sock, message, settings) {
  const key = message.key || {};

  if (key.fromMe) {
    await handleFromMeCommand(sock, key, message.message, settings);
    return;
  }

  const remoteJid = key.remoteJid;
  if (!remoteJid) return;
  if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter') || key.participant) return;
  if (hasSeen(key.id)) return;

  const senderNumber = normalizeNumber(remoteJid);
  const pushName = message.pushName || '';

  const m = message.message || {};
  let text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
  const buttonResp = m.buttonsResponseMessage;
  const listResp = m.listResponseMessage;
  const selectedId = buttonResp?.selectedButtonId || listResp?.singleSelectReply?.selectedRowId || '';

  const hasMedia = !!(m.imageMessage || m.audioMessage || m.videoMessage || m.ptvMessage);
  if (!text && !hasMedia && !selectedId) return;

  if (isAdminNumber(senderNumber, settings)) {
    const reply = await handleAdmin(sock, remoteJid, senderNumber, m, settings);
    if (reply) await sock.sendMessage(remoteJid, { text: reply });
    return;
  }
  if (numSet(settings.blockedNumbers).has(senderNumber)) return;
  if (numSet(settings.pausedNumbers).has(senderNumber)) return;
  if (settings.botPaused) return;

  let conversation = await col('conversations').findOne({ _id: senderNumber });
  if (!conversation) {
    conversation = {
      _id: senderNumber,
      isNewUser: true,
      profileNotes: {},
      messages: [],
      escalatedToOwner: false,
      lastActive: new Date(),
      createdAt: new Date(),
    };
    await col('conversations').insertOne(conversation);
  }

  if (pushName && conversation.customerName !== pushName) {
    await col('conversations').updateOne({ _id: senderNumber }, { $set: { customerName: pushName } });
    conversation.customerName = pushName;
  }

  const lang = conversation.language;

  if (selectedId) {
    await handleButtonSelection(sock, remoteJid, senderNumber, selectedId, conversation, settings);
    return;
  }

  const lower = (text || '').toLowerCase();
  if (conversation.isNewUser && /^(hi|hello|hey|namaste|hii|salaam|start|menu)/.test(lower)) {
    await sendGreeting(sock, remoteJid, settings, lang);
    await col('conversations').updateOne({ _id: senderNumber }, { $set: { isNewUser: false } });
    conversation.isNewUser = false;
    return;
  }

  if (isPaused(conversation)) return;

  const customerText = text || (hasMedia ? '(media message)' : '');
  await notifyWebhook(settings, { type: 'inbound', sender: senderNumber, name: pushName, text: customerText });

  let reply;
  if (customerText && detectEscalation(customerText)) {
    reply = await handleEscalation(sock, conversation, senderNumber, customerText, settings);
  } else if (conversation.isNewUser) {
    reply = await handleSales(conversation, customerText || 'hi', settings);
    await col('conversations').updateOne({ _id: senderNumber }, { $set: { isNewUser: false } });
    conversation.isNewUser = false;
  } else {
    reply = await handleSales(conversation, customerText, settings);
  }

  const now = new Date();
  const updates = [];
  if (customerText) updates.push({ role: 'user', content: customerText, timestamp: now });
  updates.push({ role: 'assistant', content: reply, timestamp: now });
  let messages = [...(conversation.messages || []), ...updates];
  if (messages.length > 30) messages = messages.slice(-30);
  await col('conversations').updateOne({ _id: senderNumber }, { $set: { messages, lastActive: now } });
  await sock.sendMessage(remoteJid, { text: reply });
}

async function handleButtonSelection(sock, remoteJid, senderNumber, id, conversation, settings) {
  if (id === 'lang:hindi' || id === 'lang:english') {
    const lang = id === 'lang:hindi' ? 'hindi' : 'english';
    await col('conversations').updateOne({ _id: senderNumber }, { $set: { language: lang } });
    conversation.language = lang;
    const msg = lang === 'hindi'
      ? '✅ आपने हिंदी चुनी। अब मैं आपसे हिंदी में ही बात करूँगा। 🙏\n\nक्या चाहिए? नीचे से चुनिए या सीधे बताइए।'
      : '✅ You chose English. I will chat with you in English. 🙏\n\nWhat do you need? Choose below or just tell me.';
    await sock.sendMessage(remoteJid, { text: msg });
    await sendCatalogMenu(sock, remoteJid, lang);
    return;
  }
  if (id === 'id:language') {
    await sendLanguageMenu(sock, remoteJid);
    return;
  }
  if (id === 'id:catalog') {
    await sendCatalogMenu(sock, remoteJid, conversation.language);
    return;
  }
  if (id === 'id:owner') {
    const reply = await handleEscalation(sock, conversation, senderNumber, 'owner se baat karni hai', settings);
    await sock.sendMessage(remoteJid, { text: reply });
    return;
  }
  if (id.startsWith('cat:')) {
    const cat = id.split(':')[1];
    const lang = conversation.language;
    const map = { laptop: '💻 Laptop/Computer', gaming: '🎮 Gaming PC', accessories: '🔌 Accessories' };
    const catName = map[cat] || cat;
    const reply = lang === 'hindi'
      ? 'बढ़िया! आपको *' + catName + '* चाहिए। 🙌\n\nबताइए — किस काम के लिए चाहिए (gaming, study, office)? और budget कितना रख रहे हैं?'
      : 'Great! You want *' + catName + '*. 🙌\n\nTell me — what will you use it for, and what is your budget?';
    await sock.sendMessage(remoteJid, { text: reply });
    await col('conversations').updateOne({ _id: senderNumber }, { $set: { 'profileNotes.useCase': cat } });
    return;
  }
}

export default { handleInbound };
