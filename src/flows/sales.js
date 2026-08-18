// sales.js — budget-aware recommendation flow (AI-driven).
import { getAIReply } from '../ai.js';
import { getCatalog } from '../productCatalog.js';
import { buildSystemPrompt, getActiveRules } from '../prompts.js';

// Only escalate when the customer EXPLICITLY asks to talk to a human / owner /
// manager, or clearly wants something out of a chat-bot's scope (bulk order,
// refund, complaint, negotiate price). Normal product questions must NOT match.
export function detectEscalation(text) {
  const t = (text || '').toLowerCase();

  const explicitHuman = [
    /\b(baat|talk|call|speak|contact|number|deal)\s+(karni|karo|karwa|krwa|krana|karana|mujhe|hogi?|hai|do|de|dijiye)\s+(owner|human|insaan|vyakti|person|team|sir|madam|boss|admin|aap)\b/,
    /\b(owner|human|insaan|vyakti|person|manager|sir|madam|boss|admin)\s+(se|ko|ke)\s+(baat|mil|connect|call|talk)\b/,
    /\b(mujhe|mujko)\s+(owner|human|insaan|manager|sir|madam|boss)\s+(se|ko|ke)\s+(baat|milana|milwa|connect)\b/,
    /\b(real person|real insaan|asli insaan|kisi insaan|human)\b/,
    /\binsaan se baat\b|\bhuman se baat\b|\bowner se baat\b/,
    /\bcall (karo|karwa|krwa|back)\b/,
    /\bnumber (do|de|dijiye|mujhe|chahiye)\b/,
    /\bdeal (karo|karni|karwa|krwa)\b/,
    /\bwhatsapp pe (call|baat)\b/,
  ].some((re) => re.test(t));

  const outOfScope = [
    /\b(bulk order|custom order|wholesale|b2b|reseller|dealer)\b/,
    /\b(complaint|complain karni|refund|return karna|exchange)\b/,
    /\bnegotiate price\b|\bprice negotiate\b|\bdiscount (manga|kar|chahiye|do)\b/,
    /\b(actual|exact|final) price (manga|kar|bata)\b/,
  ].some((re) => re.test(t));

  return explicitHuman || outOfScope;
}

export async function handleSales(conversation, messageText, settings) {
  const catalog = await getCatalog(settings);
  const rules = await getActiveRules();

  const system = buildSystemPrompt({
    settings,
    catalog,
    profileNotes: conversation.profileNotes || {},
    rules,
    language: conversation.language,
  });

  const messages = [{ role: 'system', content: system }];
  const history = (conversation.messages || []).slice(-20);
  for (const m of history) {
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  messages.push({ role: 'user', content: messageText });

  return await getAIReply(messages, settings);
}

export default { handleSales, detectEscalation };
