// messenger.js — inbound message pipeline for a natural, menu-free,
// multilingual human-like assistant.
import { col, saveSettings, getSettings } from './db.js';
import { isAdminNumber, normalizeNumber } from './config.js';
import { handleAdmin } from './admin.js';
import { getAIReply } from './ai.js';
import { buildSystemPrompt } from './prompts.js';
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

// Minimal human handoff — forward a short summary to the owner when the user
// explicitly asks for a human/owner/support person.
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

// Returns true when the user clearly asks to talk to a human / real person.
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

  // Owner/admin gets full control; others get the natural assistant.
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
      messages: [],
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
  const customerText = t || (hasMedia ? '(media message)' : '');

  let reply;
  if (customerText && wantsHuman(customerText)) {
    reply = await handleHumanHandoff(sock, conversation, senderNumber, customerText, settings);
  } else {
    reply = await chat(senderNumber, customerText, conversation, settings);
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

// Natural AI chat with per-user conversation history.
async function chat(key, messageText, conversation, settings) {
  const system = buildSystemPrompt();
  const messages = [{ role: 'system', content: system }];
  const history = (conversation?.messages || []).slice(-20);
  for (const h of history) {
    messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
  }
  messages.push({ role: 'user', content: messageText });
  return await getAIReply(messages, settings);
}

export default { handleInbound };
