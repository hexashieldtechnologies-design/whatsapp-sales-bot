// messenger.js — inbound message pipeline for a natural, menu-free,
// multilingual human-like assistant.
import { col, saveSettings, getSettings } from './db.js';
import { isAdminNumber, normalizeNumber } from './config.js';
import { handleAdmin } from './admin.js';
import { getAIReply } from './ai.js';
import { buildSystemPrompt } from './prompts.js';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STICKERS = {
  laugh: path.join(__dirname, 'assets', 'stickers', 'laugh.webp'),
  love: path.join(__dirname, 'assets', 'stickers', 'love.webp'),
  sad: path.join(__dirname, 'assets', 'stickers', 'sad.webp'),
  angry: path.join(__dirname, 'assets', 'stickers', 'angry.webp'),
  surprise: path.join(__dirname, 'assets', 'stickers', 'surprise.webp'),
  celebrate: path.join(__dirname, 'assets', 'stickers', 'celebrate.webp'),
  thumbsup: path.join(__dirname, 'assets', 'stickers', 'thumbsup.webp'),
  ok: path.join(__dirname, 'assets', 'stickers', 'ok.webp'),
};

const GIFS = {
  thumbsup: path.join(__dirname, 'assets', 'gifs', 'thumbsup.gif'),
  clap: path.join(__dirname, 'assets', 'gifs', 'clap.gif'),
  celebrate: path.join(__dirname, 'assets', 'gifs', 'celebrate.gif'),
  laugh: path.join(__dirname, 'assets', 'gifs', 'laugh.gif'),
  wave: path.join(__dirname, 'assets', 'gifs', 'wave.gif'),
};

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

const TAG_RE = /\[(STICKER|GIF):([a-z0-9]+)\]/i;
function extractMediaTag(replyText) {
  if (!replyText) return { text: replyText, media: null };
  const endMatch = replyText.match(/\s*\[(STICKER|GIF):([a-z0-9]+)\]\s*$/i);
  const m = endMatch || replyText.match(TAG_RE);
  if (!m) return { text: replyText, media: null };
  const kind = m[1].toLowerCase();
  const emotion = m[2].toLowerCase();
  const text = replyText.replace(m[0], '').trim();
  return { text, media: { kind, emotion } };
}

async function handleHumanHandoff(sock, conversation, conversationKey, latestText, settings) {
  const ownerNumber = settings.ownerWhatsappNumber;
  const autoNumber = String(conversationKey || '').replace(/@s\.whatsapp\.net$/, '');
  const customerName = conversation.customerName || 'unknown';
  const recent = (conversation.messages || []).slice(-8)
    .map((m) => `${m.role === 'assistant' ? 'Bot' : 'Customer'}: ${m.content}`)
    .join('\n');
  const summary = `🔔 Customer wants to talk to a human\n\nCustomer: ${customerName}\nWhatsApp: ${autoNumber}\nChat link: https://wa.me/${autoNumber}\n\nRecent conversation:\n${recent || '(none)'}\n\nLatest message:\n"${latestText}"`;
  if (ownerNumber) {
    try {
      await sock.sendMessage(`${ownerNumber}@s.whatsapp.net`, { text: summary });
    } catch (e) {
      logger.error({ err: e.message }, 'failed to notify owner');
    }
  } else {
    logger.warn('no ownerWhatsappNumber set — cannot forward handoff');
  }
  return 'Main aapki baat aage pahuncha raha hoon. Koi human aapse jald hi contact karenge. 🙏';
}

function wantsHuman(text) {
  const t = (text || '').toLowerCase();
  const patterns = [
    /(baat|talk|call|speak|contact|connect|milw|milana|connect)\s+(karni|karo|karwa|krwa|krana|karana|mujhe|hogi?|hai|do|de|dijiye|chahiye)\s+(owner|human|insaan|vyakti|person|team|sir|madam|boss|admin|aap|agent)/,
    /(owner|human|insaan|vyakti|person|manager|sir|madam|boss|admin|agent)\s+(se|ko|ke|to)\s+(baat|mil|connect|call|talk)/,
    /(real person|real insaan|asli insaan|kisi insaan|human agent|support team|support person)/,
    /insaan se baat|human se baat|owner se baat|customer care|customer service/,
  ];
  return patterns.some((re) => re.test(t));
}

async function handleFromMeCommand(sock, key, message) {
  const text = (message?.conversation || message?.extendedTextMessage?.text || '').trim();
  const lower = text.toLowerCase();
  const remoteJid = key.remoteJid;
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) return false;
  const customerNumber = normalizeNumber(remoteJid);
  const isStop = /^[./]?stop\b/.test(lower) && !/botanist|stopover/.test(lower);
  const isStart = /^[./]?start\b/.test(lower) && !/starter|restart/.test(lower);
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

async function sendReply(sock, remoteJid, rawReply) {
  const { text, media } = extractMediaTag(rawReply);
  try {
    await sock.sendMessage(remoteJid, { text: text || ' ' });
  } catch (e) {
    logger.error({ err: e.message }, 'failed to send text reply');
  }
  if (media) {
    try {
      if (media.kind === 'sticker') {
        const p = STICKERS[media.emotion];
        if (p) await sock.sendMessage(remoteJid, { sticker: { url: p } });
        else logger.warn({ emotion: media.emotion }, 'unknown sticker emotion — skipped');
      } else if (media.kind === 'gif') {
        const p = GIFS[media.emotion];
        if (p) await sock.sendMessage(remoteJid, { video: { url: p }, gifPlayback: true });
        else logger.warn({ emotion: media.emotion }, 'unknown gif emotion — skipped');
      }
    } catch (e) {
      logger.error({ err: e.message, kind: media.kind, emotion: media.emotion }, 'failed to send sticker/gif');
    }
  }
  return text || rawReply;
}

export async function handleInbound(sock, message, settings) {
  const key = message.key || {};
  if (key.fromMe) {
    await handleFromMeCommand(sock, key, message.message);
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
  const isNewUser = !conversation;
  if (!conversation) {
    conversation = { _id: senderNumber, messages: [], lastActive: new Date(), createdAt: new Date() };
    await col('conversations').insertOne(conversation);
  }
  if (pushName && conversation.customerName !== pushName) {
    await col('conversations').updateOne({ _id: senderNumber }, { $set: { customerName: pushName } });
    conversation.customerName = pushName;
  }
  const t = text.trim();
  const customerText = t || (hasMedia ? '(media message)' : '');
  let reply;
  if (customerText && wantsHuman(customerText)) {
    reply = await handleHumanHandoff(sock, conversation, senderNumber, customerText, settings);
  } else {
    reply = await chat(senderNumber, customerText, conversation, settings, isNewUser);
  }
  const now = new Date();
  const updates = [];
  if (customerText) updates.push({ role: 'user', content: customerText, timestamp: now });
  const cleanReply = await sendReply(sock, remoteJid, reply);
  updates.push({ role: 'assistant', content: cleanReply, timestamp: now });
  let messages = [...(conversation.messages || []), ...updates];
  if (messages.length > 30) messages = messages.slice(-30);
  await col('conversations').updateOne({ _id: senderNumber }, { $set: { messages, lastActive: now } });
}

async function chat(key, messageText, conversation, settings, isNewUser) {
  const system = buildSystemPrompt(isNewUser);
  const messages = [{ role: 'system', content: system }];
  const history = (conversation?.messages || []).slice(-20);
  for (const h of history) {
    messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
  }
  messages.push({ role: 'user', content: messageText });
  return await getAIReply(messages, settings);
}

export default { handleInbound };
