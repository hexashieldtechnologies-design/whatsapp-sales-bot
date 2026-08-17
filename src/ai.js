// ai.js — provider-agnostic AI adapter with a robust fallback chain.
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const FALLBACK_REPLY = 'Ek second, thoda technical issue aa raha hai. Main abhi dobara try karta hoon, aap bas thoda ruk jaiye. 🙏';

function toList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (v == null) return [];
  return String(v).split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
}

function cleanOutput(text) {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^<think>[\s\S]*$/gi, '').trim();
}

function endpointFor(provider) {
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
  if (provider === 'gemini') return 'gemini';
  return 'https://api.groq.com/openai/v1/chat/completions';
}

async function callProviderChat(provider, apiKey, model, messages) {
  if (provider === 'gemini') {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({ model });
    let system = '';
    const parts = [];
    for (const m of messages) {
      if (m.role === 'system') system += (system ? '\n' : '') + m.content;
      else parts.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
    const chat = gm.startChat({ systemInstruction: system || undefined, history: parts.length > 1 ? parts.slice(0, -1) : [] });
    const last = parts[parts.length - 1];
    const result = await chat.sendMessage(last.parts[0].text);
    const text = result.response.text();
    if (!text) throw new Error('empty response');
    return cleanOutput(text);
  }
  const res = await fetch(endpointFor(provider), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 800 }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('provider ' + res.status + ': ' + txt.slice(0, 200));
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('empty response from provider');
  return cleanOutput(content);
}

function buildChain(cfg) {
  const chain = [];
  const active = (cfg.aiProvider || cfg.provider || 'openrouter').toLowerCase();
  const order = [active].concat(['openrouter', 'groq', 'gemini'].filter((p) => p !== active));
  for (const p of order) {
    const keys = toList(cfg[p + 'ApiKey'] || cfg[p + 'ApiKeys']);
    if (!keys.length) continue;
    const models = toList(cfg[p + 'Model'] || cfg[p + 'Models']);
    const ml = models.length ? models : (p === 'openrouter' ? ['google/gemma-4-31b-it:free'] : p === 'groq' ? ['openai/gpt-oss-20b'] : ['gemini-2.0-flash']);
    for (const key of keys) for (const model of ml) chain.push({ provider: p, apiKey: key, model: model });
  }
  return chain;
}

export async function getAIReply(messages, cfg) {
  const chain = buildChain(cfg);
  if (!chain.length) { logger.warn('no AI config'); return FALLBACK_REPLY; }
  let lastErr = null;
  for (const entry of chain) {
    try {
      const text = await callProviderChat(entry.provider, entry.apiKey, entry.model, messages);
      logger.info({ provider: entry.provider, model: entry.model }, 'AI reply succeeded');
      return text;
    } catch (e) {
      lastErr = e;
      logger.warn({ err: e.message, provider: entry.provider, model: entry.model, key: entry.apiKey.slice(0, 8) }, 'entry failed');
    }
  }
  logger.error({ err: lastErr ? lastErr.message : '' }, 'all AI entries failed');
  return FALLBACK_REPLY;
}

export default { getAIReply, FALLBACK_REPLY };
