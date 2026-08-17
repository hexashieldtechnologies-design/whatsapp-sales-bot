// /settings — simple web form to edit runtime config.
import express from 'express';
import { getSettings, saveSettings } from '../db.js';

const router = express.Router();

const FIELD_NAMES = [
  'businessName', 'productApiUrl', 'productApiCreateUrl', 'aiProvider',
  'groqApiKey', 'groqModel', 'groqVisionModel',
  'openrouterApiKey', 'openrouterModel', 'geminiApiKey', 'geminiModel',
  'ownerWhatsappNumber', 'adminNumbers', 'broadcastWindowDays',
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderForm(settings, saved = false) {
  const value = (k) => esc(settings[k] ?? '');
  const selected = (k, v) => ((settings[k] ?? 'groq') === v ? 'selected' : '');
  const notify = saved ? '<div style="background:#e6f4ea;padding:10px 16px;border-radius:6px;margin-bottom:16px;">✅ Saved. Settings are live immediately.</div>' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Bot Settings</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:32px 16px;}
 .wrap{max-width:640px;margin:0 auto;}
 h1{font-size:22px;margin:0 0 4px;} p.sub{color:#9aa0aa;margin:0 0 24px;font-size:14px;}
 .card{background:#1a1d24;border:1px solid #2a2e37;border-radius:10px;padding:20px;margin-bottom:20px;}
 .card h2{font-size:15px;margin:0 0 14px;color:#c7cbd4;}
 label{display:block;font-size:13px;color:#aab0ba;margin:12px 0 4px;}
 input,select{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:7px;border:1px solid #333845;background:#13161c;color:#e6e6e6;font-size:14px;}
 button{background:#2563eb;color:#fff;border:0;padding:11px 22px;border-radius:8px;font-size:15px;cursor:pointer;margin-top:8px;}
 button:hover{background:#1d4ed8;}
</style></head><body><div class="wrap">
<h1>🤖 WhatsApp Sales Bot — Settings</h1>
<p class="sub">Changes here go straight to the database and take effect on the next message — no redeploy needed.</p>
${notify}
<form method="POST" action="/settings">
<div class="card"><h2>Business</h2>
<label>Shop / business name</label><input name="businessName" value="${value('businessName')}">
<label>Owner WhatsApp number (for escalation)</label><input name="ownerWhatsappNumber" value="${value('ownerWhatsappNumber')}" placeholder="91XXXXXXXXXX">
<label>Admin numbers (comma-separated; empty = owner number only)</label><input name="adminNumbers" value="${value('adminNumbers')}" placeholder="91XXXXXXXXXX,91YYYYYYYYYY">
</div>
<div class="card"><h2>Product catalog source</h2>
<label>Product API URL (GET → JSON array)</label><input name="productApiUrl" value="${value('productApiUrl')}" placeholder="https://yourapi.com/products">
<label>Product API create URL (optional POST endpoint)</label><input name="productApiCreateUrl" value="${value('productApiCreateUrl')}" placeholder="leave blank to store in DB">
</div>
<div class="card"><h2>AI provider</h2>
<label>Provider</label>
<select name="aiProvider">
<option value="groq" ${selected('aiProvider','groq')}>Groq (default)</option>
<option value="gemini" ${selected('aiProvider','gemini')}>Google AI Studio (Gemini)</option>
<option value="openrouter" ${selected('aiProvider','openrouter')}>OpenRouter</option>
</select>
<label>Groq API key</label><input name="groqApiKey" value="${value('groqApiKey')}">
<label>Groq model</label><input name="groqModel" value="${value('groqModel')}">
<label>Groq vision model</label><input name="groqVisionModel" value="${value('groqVisionModel')}">
<label>Gemini API key</label><input name="geminiApiKey" value="${value('geminiApiKey')}">
<label>Gemini model</label><input name="geminiModel" value="${value('geminiModel')}">
<label>OpenRouter API key</label><input name="openrouterApiKey" value="${value('openrouterApiKey')}">
<label>OpenRouter model</label><input name="openrouterModel" value="${value('openrouterModel')}">
</div>
<div class="card"><h2>Broadcast</h2>
<label>Broadcast window (days)</label><input name="broadcastWindowDays" type="number" value="${value('broadcastWindowDays')}">
</div>
<button type="submit">Save settings</button>
</form></div></body></html>`;
}

router.get('/', async (req, res) => {
  try { res.send(renderForm(await getSettings())); }
  catch (e) { res.status(500).send('DB error: ' + e.message); }
});

router.post('/', async (req, res) => {
  try {
    const patch = {};
    for (const k of FIELD_NAMES) if (req.body[k] !== undefined) patch[k] = String(req.body[k]).trim();
    if (patch.broadcastWindowDays !== undefined) {
      const n = parseInt(patch.broadcastWindowDays, 10);
      patch.broadcastWindowDays = Number.isFinite(n) && n > 0 ? n : 45;
    }
    const settings = await saveSettings(patch);
    res.send(renderForm(settings, true));
  } catch (e) { res.status(500).send('Save error: ' + e.message); }
});

export default router;
