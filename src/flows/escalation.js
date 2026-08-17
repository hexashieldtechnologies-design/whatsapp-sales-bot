// escalation.js — forward the customer to the human owner. Asks for the
// customer's number (if they want a call/contact) and sends a summary incl.
// their number + full context to the owner, then pauses auto-replies.
import { col } from '../db.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PAUSE_MS = 3 * 60 * 60 * 1000;

export async function handleEscalation(sock, conversation, conversationKey, latestText, settings) {
  const ownerNumber = settings.ownerWhatsappNumber;
  const businessName = settings.businessName || 'our store';

  const recent = (conversation.messages || []).slice(-8).map((m) => `${m.role === 'assistant' ? 'Bot' : 'Customer'}: ${m.content}`).join('\n');

  const typedNumber = (latestText || '').match(/[6-9]\d{9}|(?:\+?91)?[6-9]\d{9}/);
  const customerNumber = typedNumber ? typedNumber[0] : conversationKey.replace(/@s\..+$/, '');

  const summary = `🔔 Customer wants to talk to you\n\nBusiness: ${businessName}\nCustomer number: ${customerNumber}\nWhatsApp JID: ${conversationKey}\n\nRecent conversation:\n${recent || '(none)'}\n\nLatest message:\n"${latestText}"`;

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
    {
      $set: {
        escalatedToOwner: true,
        escalatedAt: new Date(),
        customerNumber,
        autoReplyPausedUntil: new Date(Date.now() + PAUSE_MS),
      },
    }
  );

  return 'Main aapki baat owner tak pahuncha raha hoon. Woh jald hi aapse contact karenge. 🙏';
}

export function isPaused(conversation) {
  if (!conversation || !conversation.autoReplyPausedUntil) return false;
  return new Date(conversation.autoReplyPausedUntil) > new Date();
}

export default { handleEscalation, isPaused };
