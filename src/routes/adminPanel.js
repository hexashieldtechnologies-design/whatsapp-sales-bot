// adminPanel.js — single protected page: password login, then QR (top) +
// settings (bottom) together. Password defaults to 'dev'.
import express from 'express';
import qrcode from 'qrcode';
import { getSettings, saveSettings } from '../db.js';

const router = express.Router();

const COOKIE_NAME = 'wa_admin';
const FIELD_NAMES = [
  'businessName', 'productApiUrl', 'productApiCreateUrl', 'aiProvider',
  'groqApiKey', 'groqModel', 'groqVisionModel',
  'openrouterApiKey', 'openrouterModel', 'geminiApiKey', 'geminiModel',
  'ownerWhatsappNumber', 'adminNumbers', 'broadcastWindowDays',
];

function getPassword() {
  return process.env.ADMIN_PASSWORD || process.env.QR_PASSWORD || 'dev';
}

function makeToken(pass) {
  return Buffer.from(pass).toString('base64');
}

function isAuthed(req) {
  return req.cookies?.[COOKIE_NAME] === makeToken(getPassword());
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function baseHtml(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Bot Admin</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:24px 16px;}
 .wrap{max-width:720px;margin:0 auto;}
 h1{font-size:22px;margin:0 0 4px;} .sub{color:#9aa0aa;margin:0 0 20px;font-size:14px;}
 .card{background:#1a1d24;border:1px solid #2a2e37;border-radius:12px;padding:20px;margin-bottom:20px;}
 .card h2{font-size:16px;margin:0 0 14px;color:#e6e6e6;}
 label{display:block;font-size:13px;color:#aab0ba;margin:12px 0 4px;}
 input,select{width:100%;box-sizing:border-box;padding:10px 11px;border-radius:7px;border:1px solid #333845;background:#13161c;color:#e6e6e6;font-size:14px;}
 button{background:#2563eb;color:#fff;border:0;padding:11px 22px;border-radius:8px;font-size:15px;cursor:pointer;margin-top:8px;}
 button:hover{background:#1d4ed8;}
 .center{text-align:center;}
 .qrbox{text-align:center;padding:24px;}
 .qrbox img{width:240px;height:240px;border-radius:10px;background:#fff;padding:8px;}
 .badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;margin-bottom:8px;}
 .ok{background:#123b24;color:#4ade80;} .wait{background:#3b2f12;color:#fbbf24;}
 .err{color:#f87171;background:#3b1220;padding:10px 14px;border-radius:8px;margin-bottom:14px;}
 .note{background:#142a3b;color:#7dd3fc;padding:10px 14px;border-radius:8px;font-size:13px;margin-top:12px;}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

function loginPage(err) {
  return baseHtml(`
<h1>🔐 Bot Admin Login</h1>
<p class="sub">WhatsApp bot manage karne ke liye password daalo.</p>
${err ? `<div class="err">${err}</div>` : ''}
<div class="card center">
<form method="POST" action="/">
<label>Password</label>
<input type="password" name="password" autofocus placeholder="password">
<button type="submit" style="width:100%;">Login</button>
</form>
</div>`);
}

async function panelPage(settings, qrState, saved) {
  const value = (k) => esc(settings[k] ?? '');
  const selected = (k, v) => ((settings[k] ?? 'groq') === v ? 'selected' : '');

  let qrSection = '';
  if (qrState.connected && qrState.me) {
    qrSection = `<div class="card qrbox"><h2>📱 WhatsApp Status</h2>
<span class="badge ok">✅ Connected</span>
<p style="font-size:18px;margin:8px 0;">${esc(qrState.me)}</p></div>`;
  } else if (qrState.qr) {
    let img = '';
    try { img = await qrcode.toDataURL(qrState.qr); } catch (e) { img = ''; }
    qrSection = `<div class="card qrbox"><h2>📱 Scan to connect WhatsApp</h2>
<span class="badge wait">QR active — auto-refresh</span>
<p style="color:#9aa0aa;">WhatsApp &gt; Linked devices &gt; Link a device</p>
${img ? `<img src="${img}" alt="QR">` : '<p>QR loading…</p>'}
<div class="note">Ye page har 4 second mein refresh hota hai jab tak connect nahi ho jata.</div></div>`;
  } else {
    qrSection = `<div class="card qrbox"><h2>📱 WhatsApp Status</h2>
<span class="badge wait">⏳ Connecting…</span>
<p style="color:#9aa0aa;">QR generate hone ka wait ho raha hai (refresh karein).</p></div>`;
  }

  const savedNote = saved ? '<div style="background:#e6f4ea;color:#14532d;padding:10px 14px;border-radius:8px;margin-bottom:16px;">✅ Saved. Settings live ho gaye.</div>' : '';

  return baseHtml(`
<h1>🤖 WhatsApp Sales Bot</h1>
<p class="sub">QR scan karo (upar) + settings (neeche) — sab ek hi page par.</p>
${qrSection}
<form method="POST" action="/">
<div class="card"><h2>⚙️ Settings</h2>${savedNote}
<label>Shop / business name</label><input name="businessName" value="${value('businessName')}">
<label>Owner WhatsApp number (escalation)</label><input name="ownerWhatsappNumber" value="${value('ownerWhatsappNumber')}" placeholder="91XXXXXXXXXX">
<label>Admin numbers (comma-separated)</label><input name="adminNumbers" value="${value('adminNumbers')}" placeholder="91XXXXXXXXXX,91YYYYYYYYYY">
<label>Product API URL (GET → JSON array)</label><input name="productApiUrl" value="${value('productApiUrl')}" placeholder="https://yourapi.com/products">
<label>Product API create URL (optional)</label><input name="productApiCreateUrl" value="${value('productApiCreateUrl')}" placeholder="leave blank to store in DB">
<label>AI Provider</label>
<select name="aiProvider">
<option value="groq" ${selected('aiProvider','groq')}>Groq (default)</option>
<option value="gemini" ${selected('aiProvider','gemini')}>Gemini</option>
<option value="openrouter" ${selected('aiProvider','openrouter')}>OpenRouter</option>
</select>
<label>Groq API key</label><input name="groqApiKey" value="${value('groqApiKey')}">
<label>Groq model</label><input name="groqModel" value="${value('groqModel')}">
<label>Groq vision model</label><input name="groqVisionModel" value="${value('groqVisionModel')}">
<label>Gemini API key</label><input name="geminiApiKey" value="${value('geminiApiKey')}">
<label>Gemini model</label><input name="geminiModel" value="${value('geminiModel')}">
<label>OpenRouter API key</label><input name="openrouterApiKey" value="${value('openrouterApiKey')}">
<label>OpenRouter model</label><input name="openrouterModel" value="${value('openrouterModel')}">
<label>Broadcast window (days)</label><input name="broadcastWindowDays" type="number" value="${value('broadcastWindowDays')}">
<button type="submit">Save settings</button>
</div>
</form>
<form method="POST" action="/logout"><button type="submit" style="background:#dc2626;">Logout</button></form>`);
}

export function makeAdminPanelRouter(getQrState) {
  router.get('/', async (req, res) => {
    if (!isAuthed(req)) return res.send(loginPage());
    const settings = await getSettings();
    const qrState = getQrState ? getQrState() : {};
    if (qrState.qr && !qrState.connected) res.setHeader('Refresh', '4');
    res.send(await panelPage(settings, qrState, false));
  });

  router.post('/', async (req, res) => {
    const pass = getPassword();
    if (req.body.password !== undefined) {
      if (req.body.password === pass) {
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${makeToken(pass)}; Path=/; HttpOnly; SameSite=Lax`);
        return res.redirect('/');
      }
      return res.status(401).send(loginPage('❌ Galat password.'));
    }
    if (!isAuthed(req)) return res.redirect('/');
    const patch = {};
    for (const k of FIELD_NAMES) if (req.body[k] !== undefined) patch[k] = String(req.body[k]).trim();
    if (patch.broadcastWindowDays !== undefined) {
      const n = parseInt(patch.broadcastWindowDays, 10);
      patch.broadcastWindowDays = Number.isFinite(n) && n > 0 ? n : 45;
    }
    const settings = await saveSettings(patch);
    const qrState = getQrState ? getQrState() : {};
    res.send(await panelPage(settings, qrState, true));
  });

  router.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0`);
    res.redirect('/');
  });

  return router;
}

export default makeAdminPanelRouter;
