// admin.js — owner/admin control layer (stop/start/block/train). No product,
// broadcast, or shop features.
import { aiConfig, normalizeNumber } from './config.js';
import { getAIReply } from './ai.js';
import { saveSettings, getSettings } from './db.js';

function listSet(csv) {
  return new Set(String(csv || '').split(',').map((x) => x.trim()).filter(Boolean).map(normalizeNumber));
}

const MENU = `Admin mode ✅ — aap ye kar sakte hain:
1️⃣ Bot ko train karo ('train: <instructions>')
2️⃣ .stop — sab band  |  .stop 91XXXXX — sirf us customer ko band
    .start — sab chalu  |  .start 91XXXXX — sirf us customer ko chalu
3️⃣ .block 91XXX / .unblock 91XXX — number block/unblock
4️⃣ .status — bot ki status dekho`;

export async function handleAdmin(sock, senderJid, senderNumber, message, settings) {
  const text = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || '';

  if (!text.trim()) return MENU;

  const lower = text.toLowerCase();
  if (/^(menu|help|start)$/.test(lower) || /^(hi|hello|namaste|hey)$/.test(lower)) {
    return MENU;
  }

  // ---- STOP / START (global or per-customer) ----
  const stopNum = text.match(/\.?stop\s+([0-9+\-\s]{8,})/i);
  if (stopNum) {
    const num = normalizeNumber(stopNum[1]);
    const s = await getSettings();
    const set = listSet(s.pausedNumbers);
    set.add(num);
    await saveSettings({ pausedNumbers: [...set].join(',') });
    return '⏸️ Customer ' + num + ' ke liye bot PAUSE ho gaya. Ab isse reply nahi karega. ".start ' + num + '" se phir chalu karein.';
  }
  const startNum = text.match(/\.?start\s+([0-9+\-\s]{8,})/i);
  if (startNum) {
    const num = normalizeNumber(startNum[1]);
    const s = await getSettings();
    const set = listSet(s.pausedNumbers);
    set.delete(num);
    await saveSettings({ pausedNumbers: [...set].join(',') });
    return '▶️ Customer ' + num + ' ke liye bot RESUME ho gaya. Ab isse reply karega.';
  }

  if (/\.?stop\b/.test(lower) && !/botanist|stopover|non-?stop/.test(lower)) {
    await saveSettings({ botPaused: true });
    return '⏸️ Bot pura STOP ho gaya (sab customers ke liye). ".start" bhejo chalu karne ke liye.';
  }
  if (/\.?start\b/.test(lower) && !/starter|restart/.test(lower)) {
    await saveSettings({ botPaused: false });
    return '▶️ Bot pura START ho gaya. Ab customer messages ka reply dega.';
  }
  if (/\.?status\b/.test(lower)) {
    const s = await getSettings();
    const paused = s.pausedNumbers ? listSet(s.pausedNumbers).size : 0;
    return (s.botPaused ? '⏸️ Bot: STOPPED (sab band).' : '▶️ Bot: RUNNING.') + (paused ? ' ' + paused + ' customer individually paused.' : '');
  }

  const bm = text.match(/\.?block\s+([0-9+\-\s]+)/i);
  if (bm) {
    const num = normalizeNumber(bm[1]);
    if (!num) return '❌ Number sahi se do: ".block 91XXXXXXXXXX"';
    const s = await getSettings();
    const existing = listSet(s.blockedNumbers);
    existing.add(num);
    await saveSettings({ blockedNumbers: [...existing].join(',') });
    return '🚫 Number ' + num + ' block ho gaya. Bot isse reply nahi karega.';
  }
  const um = text.match(/\.?unblock\s+([0-9+\-\s]+)/i);
  if (um) {
    const num = normalizeNumber(um[1]);
    const s = await getSettings();
    const existing = listSet(s.blockedNumbers);
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

  // Fallback: just answer the admin naturally.
  return getAIReply([{ role: 'user', content: text }], aiConfig(settings));
}

export default { handleAdmin, MENU };
