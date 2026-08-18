// escalation.js — forward the customer to the human owner. Sends a rich summary
// (name + auto-detected WhatsApp number + wa.me link + full context) to the owner.
import { col } from '../db.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PAUSE_MS = 3 * 60 * 60 * 1000;

export async function handleEscalation(sock, conversation, conversationKey, latestText, settings) {
  const ownerNumber = settings.ownerWhatsappNumber;
  const businessName = settings.businessName || 'our store';

  const recent = (conversation.messages || []).slice(-8)
    .map((m) => `${m.role === 'assistant' ? 'Bot' : 'Customer'}: ${m.content}`)
    .join('\n');

  // Auto-detected WhatsApp number (from the chat JID). Always available.
  const autoNumber = String(conversationKey || '').replace(/@s\.whatsapp\.net$/, '').replace(/@s\.whatsapp\.net$/, '');
  const customerName = conversation.customerName || '(name un-known)';

  // A number the customer may have typed in their message (optional second number).
  const typedNumber = (latestText || '').match(/[6-9]\d{9}|(?:\+?91)?[6-9]\d{9}/);
  const extraNumber = typedNumber ? typedNumber[0].replace(/\+?91/, '') : '';

  const waLink = autoNumber ? `https://wa.me/${autoNumber}` : '';

  const summary = `🔔 Customer wants to talk to you\n\nBusiness: ${businessName}\nCustomer: ${customerName}\nWhatsApp number: ${autoNumber}${extraNumber && extraNumber !== autoNumber ? `\nExtra number (typed): ${extraNumber}` : ''}\nChat link: ${waLink}\n\nRecent conversation:\n${recent || '(none)'}\n\nLatest message:\n"${latestText}"`;

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
        customerNumber: autoNumber,
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
