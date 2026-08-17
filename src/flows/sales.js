// sales.js — budget-aware recommendation flow (AI-driven).
import { aiConfig } from '../config.js';
import { getAIReply } from '../ai.js';
import { getCatalog } from '../productCatalog.js';
import { buildSystemPrompt, getActiveRules } from '../prompts.js';

export function detectEscalation(text) {
  const t = (text || '').toLowerCase();
  const ownerAsk = /(owner|human|insaan|sir|madam|boss|aadmi|vyakti|person)\s+(se|ko|hai)|(baat karni|batao|karao|bhejo)/.test(t)
    || /owner se baat|insaan se baat|human se baat|talk to (owner|human|manager)|speak to/.test(t);
  const outOfScope = /bulk|custom order|wholesale|negotiate|discount (manga|kar)|complaint|refund/.test(t);
  return ownerAsk || outOfScope;
}

export async function handleSales(conversation, messageText, settings) {
  const cfg = aiConfig(settings);
  const catalog = await getCatalog(settings);
  const rules = await getActiveRules();

  const system = buildSystemPrompt({
    businessName: settings.businessName,
    catalog,
    profileNotes: conversation.profileNotes || {},
    rules,
  });

  const messages = [{ role: 'system', content: system }];
  const history = (conversation.messages || []).slice(-20);
  for (const m of history) {
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  messages.push({ role: 'user', content: messageText });

  return await getAIReply(messages, cfg);
}

export default { handleSales, detectEscalation };
