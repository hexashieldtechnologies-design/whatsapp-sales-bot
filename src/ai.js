// ai.js — provider-agnostic AI adapter.
// Chat completions (text), vision (image -> text), and audio transcription
// (voice notes) all live here so the rest of the app doesn't care which
// provider is active. Multiple API keys are tried in order for fallback.
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const FALLBACK_REPLY =
  'Ek second, thoda technical issue aa raha hai. Main abhi dobara try karta hoon, aap bas thoda ruk jaiye. 🙏';

export function hasAnyModel(cfg) {
  return Boolean(cfg && cfg.apiKey && cfg.model);
}

// Clean thinking blocks like <think>...</think> from the output to prevent
// displaying internal chain-of-thought to customers.
function cleanOutput(text) {
  if (!text) return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // strip <think>...</think>
    .replace(/^<think>[\s\S]*$/gi, '')         // strip unclosed <think>...
    .trim();
}

async function withKeyFallback(cfg, fn) {
  const keys = cfg && cfg.apiKeys && cfg.apiKeys.length ? cfg.apiKeys : (cfg && cfg.apiKey ? [cfg.apiKey] : []);
  let lastErr = null;
  for (const key of keys) {
    try {
      return await fn({ ...cfg, apiKey: key });
    } catch (e) {
      lastErr = e;
      logger.warn({ err: e.message, provider: cfg.provider }, 'key attempt failed, trying next');
    }
  }
  throw lastErr || new Error('no api keys available');
}

async function openAiCompatChat(cfg, messages, { endpoint, temperature = 0.7, maxTokens = 800 } = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`provider ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('empty response from provider');
  return cleanOutput(content);
}

async function groqChat(cfg, messages, opts) {
  return openAiCompatChat(cfg, messages, {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    ...opts,
  });
}

async function openrouterChat(cfg, messages, opts) {
  return openAiCompatChat(
    { ...cfg, model: cfg.model },
    messages,
    {
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      ...opts,
    }
  );
}

async function geminiChat(cfg, messages) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(cfg.apiKey);
  const model = genAI.getGenerativeModel({ model: cfg.model });

  let system = '';
  const parts = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n' : '') + m.content;
    } else {
      parts.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
  }
  const chat = model.startChat({
    systemInstruction: system || undefined,
    history: parts.length > 1 ? parts.slice(0, -1) : [],
  });
  const last = parts[parts.length - 1];
  const result = await chat.sendMessage(last.parts[0].text);
  const text = result.response.text();
  if (!text) throw new Error('empty response from Gemini');
  return cleanOutput(text);
}

export async function getAIReply(messages, cfg) {
  if (!hasAnyModel(cfg) && !(cfg?.apiKeys?.length)) {
    logger.warn('no AI config (apiKey/model missing) — returning fallback');
    return FALLBACK_REPLY;
  }
  try {
    return await withKeyFallback(cfg, async (c) => {
      switch (c.provider) {
        case 'openrouter':
          return await openrouterChat(c, messages);
        case 'gemini':
          return await geminiChat(c, messages);
        case 'groq':
        default:
          return await groqChat(c, messages);
      }
    });
  } catch (e) {
    logger.error({ err: e.message, provider: cfg.provider }, 'AI reply failed');
    return FALLBACK_REPLY;
  }
}

export async function extractJSON(schema, prompt, cfg) {
  const messages = [
    { role: 'system', content: 'You output only valid JSON. No markdown fences, no commentary.' },
    { role: 'user', content: prompt },
  ];
  if (!hasAnyModel(cfg) && !(cfg?.apiKeys?.length)) throw new Error('no AI model configured');
  try {
    let raw = await withKeyFallback(cfg, async (c) => {
      if (c.provider === 'gemini') {
        return await geminiChat(c, [
          messages[0],
          { role: 'user', content: prompt + '\n\nReturn ONLY a JSON object matching this shape:\n' + JSON.stringify(schema) },
        ]);
      }
      const endpoint = c.provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.groq.com/openai/v1/chat/completions';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
        body: JSON.stringify({
          model: c.model,
          messages,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 1500,
        }),
      });
      if (!res.ok) throw new Error('provider ' + res.status);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('empty JSON response');
      return content;
    });
    if (!raw) throw new Error('empty JSON response');
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    logger.error({ err: e.message }, 'extractJSON failed');
    throw e;
  }
}

export async function describeImage(imageDataUrl, instruction, cfg) {
  try {
    return await withKeyFallback(cfg, async (c) => {
      if (c.provider === 'gemini') {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(c.apiKey);
        const model = genAI.getGenerativeModel({ model: c.model });
        const base64 = imageDataUrl.split(',')[1];
        const mime = imageDataUrl.match(/^data:([^;]+)/)?.[1] || 'image/jpeg';
        const result = await model.generateContent([
          { inlineData: { data: base64, mimeType: mime } },
          { text: instruction },
        ]);
        return cleanOutput(result.response.text());
      }
      const visionModel = c.visionModel || c.model;
      const endpoint = c.provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.groq.com/openai/v1/chat/completions';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
        body: JSON.stringify({
          model: visionModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: imageDataUrl } },
                { type: 'text', text: instruction },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 1000,
        }),
      });
      if (!res.ok) throw new Error('vision provider ' + res.status);
      const data = await res.json();
      return cleanOutput(data?.choices?.[0]?.message?.content || '');
    });
  } catch (e) {
    logger.error({ err: e.message }, 'describeImage failed');
    throw e;
  }
}

export default { getAIReply, extractJSON, describeImage, hasAnyModel, FALLBACK_REPLY };
