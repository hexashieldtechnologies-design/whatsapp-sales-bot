// admin.js — admin control layer dispatcher.
import pino from 'pino';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { aiConfig, normalizeNumber } from './config.js';
import { getAIReply, extractJSON, describeImage } from './ai.js';
import { transcribeAudio, bufferToDataUrl, hostImage } from './media.js';
import { saveSettings, getSettings } from './db.js';
import * as addProduct from './flows/addProduct.js';
import * as broadcast from './flows/broadcast.js';
import * as rules from './flows/rules.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const pending = new Map();

const MENU = `Admin mode ✅ — aap ye kar sakte hain:
1️⃣ Naya product add karo
2️⃣ Sabko broadcast bhejo
3️⃣ Ek rule set karo
4️⃣ Sab products delete karo
5️⃣ Bot ko train karo ('train: <instructions>')
6️⃣ .stop — bot band   |   .start — bot chalu   |   .status — bot ka haal
7️⃣ .block 91XXX — number block   |   .unblock 91XXX
Bas type/photo/voice mein bata dijiye.`;

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['add_product', 'broadcast', 'set_rule', 'delete_all_products', 'train', 'general'] },
    payload: { type: 'string' },
  },
};

async function classify(text, settings) {
  const cfg = aiConfig(settings);
  const prompt = `Classify the admin's message into one intent: add_product, broadcast, set_rule, delete_all_products, train, or general.
Return JSON { intent, payload } where payload is the extracted content. If the admin is teaching/training the bot, use train. Message: """${text}"""`;
  try {
    return await extractJSON(INTENT_SCHEMA, prompt, cfg);
  } catch {
    return { intent: 'general', payload: text };
  }
}

function messageKind(message) {
  if (message.imageMessage) return 'image';
  if (message.audioMessage || message.ptvMessage) return 'audio';
  return 'text';
}

export async function handleAdmin(sock, senderJid, senderNumber, message, settings) {
  const kind = messageKind(message);
  const text = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || '';
  const state = pending.get(senderNumber);

  if (state && kind === 'text' && text.trim()) {
    pending.delete(senderNumber);
    const t = text.trim().toLowerCase();
    const confirmed = /^(haan|yes|sahi|ok|okay|confirm|theek|ji haan|ha|ji)/.test(t);
    const cancelled = /^(nahi|no|cancel|nahi chahiye|nhi)/.test(t);

    if (state.type === 'product' && confirmed) return addProduct.saveProduct(state.product, settings, state.imageUrl);
    if (state.type === 'product' && (cancelled || !confirmed)) return '❌ Okay, product add cancel kar diya.';
    if (state.type === 'broadcast' && confirmed) {
      const nums = await broadcast.getTargetRecipients(settings);
      const jids = nums.map((n) => `${n}@s.whatsapp.net`);
      if (!jids.length) return '⚠️ Koi recent customer nahi mila broadcast ke liye.';
      const { sent, failed } = await broadcast.sendBroadcast(sock, jids, state.messageText);
      await broadcast.logBroadcast(state.messageText, jids.length, sent, failed);
      return `📣 Broadcast complete — ${sent} bheja, ${failed} fail (total ${jids.length}).`;
    }
    if (state.type === 'broadcast' && (cancelled || !confirmed)) return '❌ Broadcast cancel kar diya.';
    if (state.type === 'rule' && confirmed) return rules.addRule(state.rule);
    if (state.type === 'rule' && (cancelled || !confirmed)) return '❌ Rule set nahi kiya.';
    if (state.type === 'delete_all' && confirmed) return addProduct.deleteAllProducts();
    if (state.type === 'delete_all' && (cancelled || !confirmed)) return '❌ Delete cancel kar diya.';
  }

  if (kind === 'image' || kind === 'audio') {
    return handleMediaAddProduct(sock, senderNumber, text, message, settings);
  }

  if (!text.trim()) return MENU;

  const lower = text.toLowerCase();
  if (/^(menu|help|start)$/.test(lower) || /^(hi|hello|namaste|hey)$/.test(lower)) {
    pending.delete(senderNumber);
    return MENU;
  }
  if (/rules?\s*dikhao|show\s*rules|list\s*rules/.test(lower)) return rules.listRules();
  const rm = text.match(/rule\s+(\d+)\s+(hata|remove|delete|deactivate)/i);
  if (rm) return rules.removeRule(parseInt(rm[1], 10));

  if (/delete (all|sab|saare|sara)|sab (products?|data|saare) (delete|hata|udaa)|sara data delete|clear all products|all products? delete/i.test(lower)) {
    pending.set(senderNumber, { type: 'delete_all' });
    return '⚠️ Aap SAB products delete karna chahte hain (DB se)? Ye undo nahi ho sakta.\n\nConfirm karo (haan/nahi).';
  }

  if (/\.?stop\b/.test(lower) && !/botanist|stopover|non-?stop/.test(lower)) {
    await saveSettings({ botPaused: true });
    return '⏸️ Bot STOP ho gaya. Ab customer messages ka reply nahi dega. ".start" bhejo chalu karne ke liye.';
  }
  if (/\.?start\b/.test(lower) && !/starter|restart/.test(lower)) {
    await saveSettings({ botPaused: false });
    return '▶️ Bot START ho gaya. Ab customer messages ka reply dega.';
  }
  if (/\.?status\b/.test(lower)) {
    const s = await getSettings();
    return s.botPaused ? '⏸️ Bot status: STOPPED (reply nahi de raha).' : '▶️ Bot status: RUNNING (reply de raha).';
  }
  const bm = text.match(/\.?block\s+([0-9+\-\s]+)/i);
  if (bm) {
    const num = normalizeNumber(bm[1]);
    if (!num) return '❌ Number sahi se do: ".block 91XXXXXXXXXX"';
    const s = await getSettings();
    const existing = new Set((s.blockedNumbers || '').split(',').map(normalizeNumber).filter(Boolean));
    existing.add(num);
    await saveSettings({ blockedNumbers: [...existing].join(',') });
    return '🚫 Number ' + num + ' block ho gaya. Bot isse reply nahi karega.';
  }
  const um = text.match(/\.?unblock\s+([0-9+\-\s]+)/i);
  if (um) {
    const num = normalizeNumber(um[1]);
    const s = await getSettings();
    const existing = new Set((s.blockedNumbers || '').split(',').map(normalizeNumber).filter(Boolean));
    existing.delete(num);
    await saveSettings({ blockedNumbers: [...existing].join(',') });
    return '✅ Number ' + num + ' unblock ho gaya.';
  }

  const trainMatch = text.match(/^train\s*[:\-]\s*(.+)$/is);
  if (trainMatch) {
    const instruction = trainMatch[1].trim();
    await saveSettings({ ownerTraining: instruction });
    return '✅ Bot trained! Naya training: "' + instruction.slice(0, 200) + (instruction.length > 200 ? '...' : '') + '"';
  }

  const { intent, payload } = await classify(text, settings);

  switch (intent) {
    case 'add_product': {
      if (!payload || !payload.trim()) return 'Product ki details bhejiye — text, photo, ya voice note.';
      const product = await addProduct.parseProduct(payload, settings);
      pending.set(senderNumber, { type: 'product', product, imageUrl: null });
      return addProduct.previewProduct(product);
    }
    case 'broadcast': {
      if (!payload || !payload.trim()) return 'Kya message sabko bhejna hai? Bataiye.';
      const clean = payload.replace(/^(sabko msg karke bol do ki|sabko bolo|broadcast)\s*/i, '').trim();
      pending.set(senderNumber, { type: 'broadcast', messageText: clean || payload });
      return `Ye message sabko bhejun? — "${clean || payload}" — confirm karo (haan/nahi).`;
    }
    case 'set_rule': {
      if (!payload || !payload.trim()) return 'Kya rule set karna hai? Bataiye.';
      const rule = await rewriteRule(payload, settings);
      pending.set(senderNumber, { type: 'rule', rule });
      return `Rule aise save karu?\n"${rule}"\n\nConfirm karo (haan/nahi).`;
    }
    case 'delete_all_products': {
      pending.set(senderNumber, { type: 'delete_all' });
      return '⚠️ Aap SAB products delete karna chahte hain (DB se)? Ye undo nahi ho sakta.\n\nConfirm karo (haan/nahi).';
    }
    case 'train': {
      const instruction = payload && payload.trim() ? payload.trim() : '';
      if (!instruction) return 'Kya sikhana hai bot ko? "train: <instructions>" likho.';
      await saveSettings({ ownerTraining: instruction });
      return '✅ Bot trained! Naya training: "' + instruction.slice(0, 200) + (instruction.length > 200 ? '...' : '') + '"';
    }
    default:
      return getAIReply([{ role: 'user', content: text }], aiConfig(settings));
  }
}

async function handleMediaAddProduct(sock, senderNumber, caption, message, settings) {
  const cfg = aiConfig(settings);
  try {
    const buffer = await downloadMediaMessage(message, 'buffer', {});
    if (!buffer) return '❌ Media download nahi hua, dobara try kijiye.';

    if (message.imageMessage) {
      const mime = message.imageMessage.mimetype || 'image/jpeg';
      const dataUrl = bufferToDataUrl(buffer, mime);
      const instruction = 'Read this product image and describe: product name, brand, category, key specifications, and price if visible.';
      const desc = await describeImage(dataUrl, instruction, cfg);
      const product = await addProduct.parseProduct(desc + (caption ? '\nCaption: ' + caption : ''), settings);
      const imageUrl = await hostImage(dataUrl);
      pending.set(senderNumber, { type: 'product', product, imageUrl });
      return addProduct.previewProduct(product);
    }

    if (message.audioMessage || message.ptvMessage) {
      const mime = message.audioMessage?.mimetype || 'audio/ogg';
      const transcript = await transcribeAudio(buffer, mime, settings.groqApiKey);
      const product = await addProduct.parseProduct(transcript + (caption ? '\nCaption: ' + caption : ''), settings);
      pending.set(senderNumber, { type: 'product', product, imageUrl: null });
      return `🎙️ Suna: "${transcript}"\n\n` + addProduct.previewProduct(product);
    }
    return '❌ Yeh media type samajh nahi aaya.';
  } catch (e) {
    logger.error({ err: e.message }, 'media add product failed');
    return '❌ Media process karte waqt error aa gaya. Dobara try kijiye.';
  }
}

async function rewriteRule(raw, settings) {
  const cfg = aiConfig(settings);
  const prompt = `Rewrite this casual admin instruction into one clear, unambiguous standing instruction for a sales bot. Output only the instruction text. Instruction: """${raw}"""`;
  try {
    return await getAIReply([{ role: 'user', content: prompt }], cfg);
  } catch {
    return raw;
  }
}

export default { handleAdmin, MENU };
