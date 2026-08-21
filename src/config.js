// config.js — reads runtime configuration. MongoDB (settings doc) is the single
// source of truth; process.env values are used only as fallback/defaults.
import { getSettings } from './db.js';

// Normalize a phone number to a bare international string (digits only).
export function normalizeNumber(input) {
  if (!input) return '';
  return String(input).replace(/[^\d]/g, '');
}

export function adminNumbers(settings) {
  const list = [];
  const raw = (settings.adminNumbers || '').split(',').map((x) => x.trim()).filter(Boolean);
  const owner = settings.ownerWhatsappNumber;
  if (owner) list.push(owner);
  for (const r of raw) list.push(r);
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

// Split a key field into multiple keys (comma OR newline separated).
export function splitKeys(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return String(raw || '')
    .split(/[,\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Resolve the active AI config for the given provider setting.
export function aiConfig(settings) {
  const provider = (settings.aiProvider || 'openrouter').toLowerCase();
  switch (provider) {
    case 'openrouter':
      return {
        provider: 'openrouter',
        apiKeys: splitKeys(settings.openrouterApiKey),
        apiKey: splitKeys(settings.openrouterApiKey)[0] || '',
        model: settings.openrouterModel,
      };
    case 'gemini':
      return {
        provider: 'gemini',
        apiKeys: splitKeys(settings.geminiApiKey),
        apiKey: splitKeys(settings.geminiApiKey)[0] || '',
        model: settings.geminiModel,
      };
    case 'groq':
    default:
      return {
        provider: 'groq',
        apiKeys: splitKeys(settings.groqApiKey),
        apiKey: splitKeys(settings.groqApiKey)[0] || '',
        model: settings.groqModel,
      };
  }
}

export async function loadConfig() {
  return getSettings();
}

export default { loadConfig, isAdminNumber, adminNumbers, aiConfig, normalizeNumber, splitKeys };
