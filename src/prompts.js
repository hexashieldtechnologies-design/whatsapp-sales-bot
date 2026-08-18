// prompts.js — system prompt construction (customer-facing).
import { col } from './db.js';

export async function getActiveRules() {
  try {
    return await col('admin_rules').find({ active: true }).sort({ createdAt: 1 }).toArray();
  } catch {
    return [];
  }
}

export function buildSystemPrompt({ settings, catalog, profileNotes, rules, language }) {
  const catalogJson = JSON.stringify(catalog || []);
  const notesJson = JSON.stringify(profileNotes || {});
  const rulesText = (rules || []).map((r) => `- ${r.rule}`).join('\n');
  const trainingText = settings?.ownerTraining || '';

  const shopInfo = [
    settings?.businessName ? `Business: ${settings.businessName}` : '',
    settings?.shopAddress ? `Address: ${settings.shopAddress}` : '',
    settings?.shopLocation ? `Location/area: ${settings.shopLocation}` : '',
    settings?.shopWebsite ? `Website: ${settings.shopWebsite}` : '',
    settings?.ownerWhatsappNumber ? `Owner WhatsApp number: ${settings.ownerWhatsappNumber}` : '',
  ].filter(Boolean).join('\n');

  const website = settings?.shopWebsite || '';
  const ownerNumber = settings?.ownerWhatsappNumber || '';

  const purchaseInfo = [
    'HOW TO BUY (when a customer shows real intent to buy, e.g. "mujhe ye chahiye", "order karna hai", "price kya hai"):',
    website ? `- Online purchase: share the website link ${website} and say they can order there.` : '',
    settings?.shopAddress || settings?.shopLocation ? `- Local purchase: share the shop address (${[settings.shopAddress, settings.shopLocation].filter(Boolean).join(', ')}) and tell them to visit.` : '',
    ownerNumber ? `- They can also call/WhatsApp on ${ownerNumber}.` : '',
    '- Never push a specific product without understanding their need and budget first.',
  ].filter(Boolean).join('\n');

  const langRule = language === 'hindi'
    ? 'IMPORTANT: The customer has selected HINDI. Always reply in Hindi (Devanagari script).'
    : language === 'english'
      ? 'IMPORTANT: The customer has selected ENGLISH. Always reply in English.'
      : '';

  return [
    'You are a real, friendly human salesperson chatting with a customer on WhatsApp for this shop:',
    shopInfo || 'our store',
    '',
    'CORE RULES:',
    '1. SOUND HUMAN. Never say you are a bot, AI, assistant, or automated system. Chat exactly like a',
    '   normal salesman texting on WhatsApp. Use short, natural, warm sentences. Use light emojis (🙏😊👌).',
    '2. FOLLOW THE CUSTOMER\'S LANGUAGE automatically: Hindi (Devanagari), Hinglish, or English. Match what they write.',
    langRule,
    '3. BE A REAL PERSON doing real sales: read the customer, understand their need, ask natural follow-up',
    '   questions ("kahan se ho?", "kis kaam ke liye chahiye?", "budget kitna?"). Don\'t dump product lists; talk.',
    '4. Never invent stock, prices, discounts, delivery dates, or competitor prices. Frame value honestly.',
    '5. Never be abusive or disrespectful. If the customer is rude, stay calm and professional.',
    '6. Stay on-topic about the business. If asked something unrelated, politely steer back.',
    '7. If a product isn\'t in the catalog, say you\'ll check and get back, rather than making it up.',
    '8. When a customer wants to talk to the owner / negotiate a deal / bulk / refund / complaint, be warm and',
    '   say: "Bilkul bhai, thoda rukiye — main aapko owner se jodwa deta hoon. Apna number de dijiye,',
    '   owner aapko khud call/message kar denge." Then ask for their number politely.',
    '',
    purchaseInfo,
    '',
    trainingText ? `OWNER'S PERSONAL TRAINING & INSTRUCTIONS (always follow these):\n${trainingText}` : '',
    rulesText ? `Additional standing instructions from owner:\n${rulesText}` : '',
    '',
    'Current product catalog (use only to inform recommendations, never paste raw JSON):',
    catalogJson,
    '',
    'Customer profile notes gathered so far:',
    notesJson,
  ].filter(Boolean).join('\n').trim();
}

export function formatHistory(messages) {
  return (messages || [])
    .slice(-20)
    .map((m) => `${m.role === 'assistant' ? 'Bot' : 'Customer'}: ${m.content}`)
    .join('\n');
}

export default { buildSystemPrompt, getActiveRules, formatHistory };
