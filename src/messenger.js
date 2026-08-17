// messenger.js — inbound message pipeline. The admin-number check happens
// FIRST (before any other routing) and is the only gate into admin mode.
import { col } from './db.js';
import { isAdminNumber, normalizeNumber } from './config.js';
import { handleSales, detectEscalation } from './flows/sales.js';
import { handleEscalation, isPaused } from './flows/escalation.js';
import { handleAdmin } from './admin.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export async function handleInbound(sock, message, settings) {
  const key = message.key || {};
  if (key.fromMe) return;
  const remoteJid = key.remoteJid;
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) return;

  const senderNumber = normalizeNumber(remoteJid);

  const msg = {
    text: message.message?.conversation
      || message.message?.extendedTextMessage?.text
      || message.message?.imageMessage?.caption
      || message.message?.videoMessage?.caption
      || '',
    message: message.message,
  };

  const hasMedia = !!(message.message?.imageMessage || message.message?.audioMessage || message.message?.videoMessage || message.message?.ptvMessage);
  if (!msg.text && !hasMedia) return;

  if (isAdminNumber(senderNumber, settings)) {
    logger.info('admin message from %s', senderNumber);
    const reply = await handleAdmin(sock, remoteJid, senderNumber, msg.message, settings);
    await sock.sendMessage(remoteJid, { text: reply });
    return;
  }

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

  const customerText = msg.text || (hasMedia ? '(media message)' : '');

  if (isPaused(conversation)) {
    logger.info('auto-replies paused for %s', senderNumber);
    return;
  }

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

  const MAX_WINDOW = 30;
  let messages = [...(conversation.messages || []), ...updates];
  if (messages.length > MAX_WINDOW) messages = messages.slice(-MAX_WINDOW);

  await col('conversations').updateOne({ _id: senderNumber }, { $set: { messages, lastActive: now } });
  await sock.sendMessage(remoteJid, { text: reply });
}

export default { handleInbound };
