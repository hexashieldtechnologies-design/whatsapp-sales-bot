// config.js — reads runtime configuration. MongoDB (settings doc) is the single
// source of truth; process.env values are used only as fallback/defaults.
import { getSettings } from './db.js';

// Normalize a phone number to a bare international string (digits only, strip
// any leading +). Used for both admin matching and conversation keys.
export function normalizeNumber(input) {
  if (!input) return '';
  let n = String(input).replace(/[^\d]/g, '');
  // strip common country-code '91' duplication edge cases is left to caller
  return n;
}

export function adminNumbers(settings) {
  const s = settings;
  const list = [];
  const raw = (s.adminNumbers || '').split(',').map((x) => x.trim()).filter(Boolean);
  const owner = s.ownerWhatsappNumber;
  if (owner) list.push(owner);
  for (const r of raw) list.push(r);
  // normalize, dedupe
  const seen = new Set();
  return list
    .map(normalizeNumber)
    .filter((n) => n && !seen.has(n) && (seen.add(n), true));
}

export function isAdminNumber(rawNumber, settings) {
  const norm = normalizeNumber(rawNumber);
  if (!norm) return false;
  return adminNumbers(settings).includes(norm);
}

// Resolve the active AI config for the given provider setting.
export function aiConfig(settings) {
  const provider = (settings.aiProvider || 'groq').toLowerCase();
  switch (provider) {
    case 'openrouter':
      return {
        provider: 'openrouter',
        apiKey: settings.openrouterApiKey,
        model: settings.openrouterModel,
      };
    case 'gemini':
      return {
        provider: 'gemini',
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
      };
    case 'groq':
    default:
      return {
        provider: 'groq',
        apiKey: settings.groqApiKey,
        model: settings.groqModel,
        visionModel: settings.groqVisionModel,
      };
  }
}

export async function loadConfig() {
  return getSettings();
}

export default { loadConfig, isAdminNumber, adminNumbers, aiConfig, normalizeNumber };
