// messenger.js — inbound message pipeline (natural, menu-free chat).
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
    await sock.sendMessage(remoteJid, { text: '✅ Is chat ke liye auto-reply band kar diya. "start" se wapas chalu hoga.' });
    return true;
  }
  if (isStart) {
    const s = await getSettings();
    const set = numSet(s.pausedNumbers);
    set.delete(customerNumber);
    await saveSettings({ pausedNumbers: [...set].join(',') });
    await sock.sendMessage(remoteJid, { text: '✅ Is chat ke liye auto-reply chalu kar diya.' });
    return true;
  }
  return false;
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

  const t = text.trim();

  if (isPaused(conversation)) return;

  const customerText = t || (hasMedia ? '(media message)' : '');
  await notifyWebhook(settings, { type: 'inbound', sender: senderNumber, name: pushName, text: customerText });

  let reply;
  if (customerText && detectEscalation(customerText)) {
    reply = await handleEscalation(sock, conversation, senderNumber, customerText, settings);
  } else if (conversation.isNewUser) {
    reply = await handleSales(conversation, customerText || 'hi', settings);
    await col('conversations').updateOne({ _id: senderNumber }, { $set: { isNewUser: false } });
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

export default { handleInbound };
