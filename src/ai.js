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

function buildChain(cfg) {
  const chain = [];
  const active = (cfg.aiProvider || cfg.provider || 'openrouter').toLowerCase();
  const order = [active].concat(['openrouter', 'groq', 'gemini'].filter((p) => p !== active));
  for (const p of order) {
    const keys = toList(cfg[p + 'ApiKey'] || cfg[p + 'ApiKeys'] || (p === active ? cfg.apiKeys : undefined) || (p === active ? cfg.apiKey : undefined));
    if (!keys.length) continue;
    let models = toList(cfg[p + 'Model'] || cfg[p + 'Models']);
    if (!models.length && p === active && cfg.model) models = toList(cfg.model);
    const ml = models.length ? models : (p === 'openrouter' ? ['google/gemma-4-31b-it:free'] : p === 'groq' ? ['openai/gpt-oss-20b'] : ['gemini-2.0-flash']);
    for (const key of keys) for (const model of ml) chain.push({ provider: p, apiKey: key, model: model });
  }
  return chain;
}

async function callChat(provider, apiKey, model, messages, opts) {
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
  const body = { model, messages, temperature: opts && opts.temperature != null ? opts.temperature : 0.7, max_tokens: opts && opts.maxTokens ? opts.maxTokens : 800 };
  if (opts && opts.json) body.response_format = { type: 'json_object' };
  const res = await fetch(endpointFor(provider), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body),
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

export async function getAIReply(messages, cfg) {
  const chain = buildChain(cfg);
  if (!chain.length) { logger.warn('no AI config'); return FALLBACK_REPLY; }
  let lastErr = null;
  for (const entry of chain) {
    try {
      const text = await callChat(entry.provider, entry.apiKey, entry.model, messages);
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

export async function extractJSON(schema, prompt, cfg) {
  const messages = [
    { role: 'system', content: 'You output only valid JSON. No markdown fences, no commentary.' },
    { role: 'user', content: prompt + '\n\nReturn ONLY a JSON object matching this shape:\n' + JSON.stringify(schema) },
  ];
  const chain = buildChain(cfg);
  if (!chain.length) throw new Error('no AI model configured');
  let lastErr = null;
  for (const entry of chain) {
    try {
      const raw = await callChat(entry.provider, entry.apiKey, entry.model, messages, { json: true, temperature: 0.1, maxTokens: 1500 });
      return JSON.parse(String(raw).replace(/```json|```/g, '').trim());
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('extractJSON failed');
}

export async function describeImage(imageDataUrl, instruction, cfg) {
  const chain = buildChain(cfg);
  if (!chain.length) throw new Error('no AI model configured');
  let lastErr = null;
  for (const entry of chain) {
    try {
      if (entry.provider === 'gemini') {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(entry.apiKey);
        const gm = genAI.getGenerativeModel({ model: entry.model });
        const base64 = imageDataUrl.split(',')[1];
        const mime = imageDataUrl.match(/^data:([^;]+)/)?.[1] || 'image/jpeg';
        const result = await gm.generateContent([{ inlineData: { data: base64, mimeType: mime } }, { text: instruction }]);
        return cleanOutput(result.response.text());
      }
      const res = await fetch(endpointFor(entry.provider), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + entry.apiKey },
        body: JSON.stringify({
          model: entry.model,
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: imageDataUrl } }, { type: 'text', text: instruction }] }],
          temperature: 0.1,
          max_tokens: 1000,
        }),
      });
      if (!res.ok) throw new Error('vision provider ' + res.status);
      const data = await res.json();
      return cleanOutput(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('describeImage failed');
}

export default { getAIReply, extractJSON, describeImage, FALLBACK_REPLY };
