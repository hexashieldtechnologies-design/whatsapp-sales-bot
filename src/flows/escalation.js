// escalation.js — forward customer to human owner + pause window.
import { col } from '../db.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PAUSE_MS = 3 * 60 * 60 * 1000;

export async function handleEscalation(sock, conversation, conversationKey, latestText, settings) {
  const ownerNumber = settings.ownerWhatsappNumber;
  const businessName = settings.businessName || 'our store';

  const recent = (conversation.messages || []).slice(-8).map((m) => `${m.role === 'assistant' ? 'Bot' : 'Customer'}: ${m.content}`).join('\n');
  const summary = `🔔 Escalation from a customer\n\nBusiness: ${businessName}\nCustomer number: ${conversationKey}\n\nRecent conversation:\n${recent || '(none)'}\n\nLatest message:\n"${latestText}"`;

  if (ownerNumber) {
    try {
      await sock.sendMessage(`${ownerNumber}@s.whatsapp.net`, { text: summary });
    } catch (e) {
      logger.error({ err: e.message }, 'failed to notify owner');
    }
  } else {
    logger.warn('no OWNER_WHATSAPP_NUMBER set — cannot forward escalation');
  }

  await col('conversations').updateOne(
    { _id: conversationKey },
    { $set: { escalatedToOwner: true, escalatedAt: new Date(), autoReplyPausedUntil: new Date(Date.now() + PAUSE_MS) } }
  );

  return 'Main aapki baat owner tak pahuncha raha hoon, woh jald hi aapse contact karenge. 🙏';
}

export function isPaused(conversation) {
  if (!conversation || !conversation.autoReplyPausedUntil) return false;
  return new Date(conversation.autoReplyPausedUntil) > new Date();
}

export default { handleEscalation, isPaused };
