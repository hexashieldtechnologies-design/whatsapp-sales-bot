// broadcast.js — throttled mass messaging + logging.
import { col } from '../db.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function getTargetRecipients(settings) {
  const days = settings.broadcastWindowDays || 45;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const convs = await col('conversations').find({ lastActive: { $gte: cutoff } }).project({ _id: 1 }).toArray();
  return convs.map((c) => c._id);
}

export async function sendBroadcast(sock, jids, messageText) {
  let sent = 0, failed = 0;
  for (const jid of jids) {
    try { await sock.sendMessage(jid, { text: messageText }); sent++; }
    catch (e) { failed++; logger.error({ err: e.message, jid }, 'broadcast send failed'); }
    await delay(2000 + Math.floor(Math.random() * 3000));
  }
  return { sent, failed };
}

export async function logBroadcast(messageText, total, sent, failed) {
  await col('broadcasts').insertOne({ messageText, total, sent, failed, createdAt: new Date() });
}

export default { getTargetRecipients, sendBroadcast, logBroadcast };
