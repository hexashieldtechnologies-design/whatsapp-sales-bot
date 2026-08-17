// adminPanel.js — single protected page: password login, then QR + phone-number
// pairing, plus settings. QR auto-refreshes via client-side polling (no page
// reload). AI provider section is dynamic (multiple keys with fallback).
import express from 'express';
import qrcode from 'qrcode';
import { getSettings, saveSettings, MODEL_LISTS } from '../db.js';

const router = express.Router();

const COOKIE_NAME = 'wa_admin';
const FIELD_NAMES = [
  'businessName', 'shopAddress', 'shopWebsite', 'shopLocation',
  'productApiUrl', 'productApiCreateUrl', 'aiProvider',
  'groqApiKey', 'groqModel', 'groqVisionModel',
  'openrouterApiKey', 'openrouterModel', 'geminiApiKey', 'geminiModel',
  'ownerWhatsappNumber', 'adminNumbers', 'broadcastWindowDays', 'ownerTraining',
  'blockedNumbers', 'notifyWebhookUrl',
];

function getPassword() {
  return process.env.ADMIN_PASSWORD || 'dev';
}

function makeToken(pass) {
  return Buffer.from(pass).toString('base64');
}

function isAuthed(req) {
  return req.cookies?.[COOKIE_NAME] === makeToken(getPassword());
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function selectOptions(list, current) {
  let opts = '';
  const has = list.includes(current);
  if (current && !has) opts += `<option value="${esc(current)}" selected>${esc(current)} (current)</option>`;
  for (const m of list) {
    opts += `<option value="${esc(m)}" ${m === current ? 'selected' : ''}>${esc(m)}</option>`;
  }
  return opts;
}

function baseHtml(body, extraScript = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Bot Admin</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:24px 16px;}
 .wrap{max-width:720px;margin:0 auto;}
 h1{font-size:22px;margin:0 0 4px;} .sub{color:#9aa0aa;margin:0 0 20px;font-size:14px;}
 .card{background:#1a1d24;border:1px solid #2a2e37;border-radius:12px;padding:20px;margin-bottom:20px;}
 .card h2{font-size:16px;margin:0 0 14px;color:#e6e6e6;}
 label{display:block;font-size:13px;color:#aab0ba;margin:12px 0 4px;}
 input,select,textarea{width:100%;box-sizing:border-box;padding:10px 11px;border-radius:7px;border:1px solid #333845;background:#13161c;color:#e6e6e6;font-size:14px;}
 textarea{min-height:60px;resize:vertical;font-family:inherit;}
 button{background:#2563eb;color:#fff;border:0;padding:11px 22px;border-radius:8px;font-size:15px;cursor:pointer;margin-top:8px;}
 button:hover{background:#1d4ed8;}
 .center{text-align:center;}
 .qrbox{text-align:center;padding:24px;}
 .qrbox img{width:240px;height:240px;border-radius:10px;background:#fff;padding:8px;}
 .badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;margin-bottom:8px;}
 .ok{background:#123b24;color:#4ade80;} .wait{background:#3b2f12;color:#fbbf24;}
 .err{color:#f87171;background:#3b1220;padding:10px 14px;border-radius:8px;margin-bottom:14px;}
 .note{background:#142a3b;color:#7dd3fc;padding:10px 14px;border-radius:8px;font-size:13px;margin-top:12px;}
 .hint{font-size:12px;color:#6b7280;margin-top:4px;}
 .hidden{display:none;}
 .paircode{font-size:40px;letter-spacing:8px;font-weight:700;color:#4ade80;margin:12px 0;}
</style></head><body><div class="wrap">${body}</div>
${extraScript}
</body></html>`;
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

  const qrSection = `<div class="card"><h2>📱 WhatsApp connect karo</h2>
<div id="qrStatus">
${qrState.connected && qrState.me
  ? `<span class="badge ok">✅ Connected</span><p style="font-size:18px;margin:8px 0;">${esc(qrState.me)}</p>`
  : `<span class="badge wait">⏳ Connecting… QR generate hone ka wait</span>`}
</div>
<div id="qrBox" class="qrbox"></div>
<div class="note">QR apne aap har 4 second mein refresh hota hai (page reload nahi hota).</div>
<hr style="border:0;border-top:1px solid #2a2e37;margin:18px 0;">
<h2>📞 Ya phone number se link karo (no QR)</h2>
<p style="font-size:13px;color:#aab0ba;">Country code ke saath apna WhatsApp number daalo (e.g. India: 919812345678). Phir 8-digit code milega.</p>
<input id="pairPhone" placeholder="919812345678" style="letter-spacing:1px;">
<button type="button" id="pairBtn">Code lo</button>
<div id="pairResult"></div>
</div>`;

  const mo = (list, current) => selectOptions(list, current);

  return baseHtml(`
<h1>🤖 WhatsApp Sales Bot</h1>
<p class="sub">QR ya phone number se connect karo (upar) + settings (neeche).</p>
${qrSection}
<form method="POST" action="/">
<div class="card"><h2>🏪 Business</h2>
<label>Shop / business name</label><input name="businessName" value="${value('businessName')}">
<label>Shop address</label><input name="shopAddress" value="${value('shopAddress')}" placeholder="Full address">
<label>Shop location / area</label><input name="shopLocation" value="${value('shopLocation')}" placeholder="e.g. Andheri, Mumbai">
<label>Website URL (agar hai)</label><input name="shopWebsite" value="${value('shopWebsite')}" placeholder="https://yourshop.com">
<label>Owner WhatsApp number (escalation + admin)</label><input name="ownerWhatsappNumber" value="${value('ownerWhatsappNumber')}" placeholder="91XXXXXXXXXX">
<label>Admin numbers (comma-separated)</label><input name="adminNumbers" value="${value('adminNumbers')}" placeholder="91XXXXXXXXXX,91YYYYYYYYYY">
</div>
<div class="card"><h2>🚫 Number Restriction (Blocklist)</h2>
<label>Blocked numbers (comma-separated)</label><input name="blockedNumbers" value="${value('blockedNumbers')}" placeholder="91XXXXXXXXXX,91YYYYYYYYYY">
</div>
<div class="card"><h2>📦 Product catalog</h2>
<label>Product API URL (GET → JSON array)</label><input name="productApiUrl" value="${value('productApiUrl')}" placeholder="https://yourapi.com/products">
<label>Product API create URL (optional)</label><input name="productApiCreateUrl" value="${value('productApiCreateUrl')}" placeholder="leave blank to store in DB">
</div>
<div class="card"><h2>🤖 AI Provider</h2>
<label>Provider select karo</label>
<select name="aiProvider" id="aiProvider">
<option value="groq" ${selected('aiProvider','groq')}>Groq (default)</option>
<option value="gemini" ${selected('aiProvider','gemini')}>Gemini</option>
<option value="openrouter" ${selected('aiProvider','openrouter')}>OpenRouter</option>
</select>

<div id="sec-groq" class="provsec ${settings.aiProvider === 'gemini' || settings.aiProvider === 'openrouter' ? 'hidden' : ''}">
<label>Groq API keys (ek key per line — multiple keys = auto fallback)</label>
<textarea name="groqApiKey" rows="3" placeholder="gsk_...">${value('groqApiKey')}</textarea>
<label>Groq model</label><select name="groqModel">${mo(MODEL_LISTS.groq, settings.groqModel)}</select>
<label>Groq vision model</label><select name="groqVisionModel">${mo(MODEL_LISTS.groq, settings.groqVisionModel)}</select>
</div>

<div id="sec-gemini" class="provsec ${settings.aiProvider !== 'gemini' ? 'hidden' : ''}">
<label>Gemini API keys (ek key per line — multiple keys = auto fallback)</label>
<textarea name="geminiApiKey" rows="3" placeholder="AIza...">${value('geminiApiKey')}</textarea>
<label>Gemini model</label><select name="geminiModel">${mo(MODEL_LISTS.gemini, settings.geminiModel)}</select>
</div>

<div id="sec-openrouter" class="provsec ${settings.aiProvider !== 'openrouter' ? 'hidden' : ''}">
<label>OpenRouter API keys (ek key per line — multiple keys = auto fallback)</label>
<textarea name="openrouterApiKey" rows="3" placeholder="sk-or-...">${value('openrouterApiKey')}</textarea>
<label>OpenRouter model</label><select name="openrouterModel">${mo(MODEL_LISTS.openrouter, settings.openrouterModel)}</select>
</div>

<div class="hint">💡 Ek provider select karo, uski keys daalo (jitni chahiye, ek line mein ek). Ek key fail/rate-limit ho jaye to next key automatically use hoti hai (fallback).</div>
</div>
<div class="card"><h2>🔔 Notifications (optional)</h2>
<label>Notify webhook URL</label><input name="notifyWebhookUrl" value="${value('notifyWebhookUrl')}" placeholder="https://yourserver.com/hook">
</div>
<div class="card"><h2>🎓 Owner Training (optional)</h2>
<label>Apne bot ko kya sikhana hai?</label>
<textarea name="ownerTraining" placeholder="Bot ko ye batao ki kaise baat karni hai...">${value('ownerTraining')}</textarea>
</div>
<div class="card"><h2>📣 Broadcast</h2>
<label>Broadcast window (days)</label><input name="broadcastWindowDays" type="number" value="${value('broadcastWindowDays')}">
</div>
<button type="submit">Save settings</button>
</form>
<form method="POST" action="/logout"><button type="submit" style="background:#dc2626;">Logout</button></form>`,
`<script>
(function(){
  var sel = document.getElementById('aiProvider');
  function update(){
    var v = sel ? sel.value : 'groq';
    ['groq','gemini','openrouter'].forEach(function(p){
      var sec = document.getElementById('sec-'+p);
      if (sec) sec.classList.toggle('hidden', p !== v);
    });
  }
  if (sel) { sel.addEventListener('change', update); update(); }

  var pairBtn = document.getElementById('pairBtn');
  var pairPhone = document.getElementById('pairPhone');
  var pairResult = document.getElementById('pairResult');
  if (pairBtn && pairPhone) {
    pairBtn.addEventListener('click', function(){
      var p = (pairPhone.value||'').replace(/[^0-9]/g,'');
      if (!p) { pairResult.innerHTML = '<div class="err">Number daalo (country code ke saath).</div>'; return; }
      pairBtn.disabled = true;
      pairBtn.textContent = 'Loading...';
      pairResult.innerHTML = '';
      fetch('/pair', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ phone: p })
      }).then(function(r){ return r.json(); }).then(function(d){
        pairBtn.disabled = false;
        pairBtn.textContent = 'Code lo';
        if (d.ok) {
          pairResult.innerHTML = '<div class="note">Apne phone par WhatsApp kholo → Linked devices → <b>Link with phone number</b> → ye code daalo:</div><div class="paircode">'+d.code+'</div>';
        } else {
          pairResult.innerHTML = '<div class="err">'+ (d.error||'Error hua') +'</div>';
        }
      }).catch(function(){
        pairBtn.disabled = false;
        pairBtn.textContent = 'Code lo';
        pairResult.innerHTML = '<div class="err">Network error. Dobara try karo.</div>';
      });
    });
  }

  var qrStatus = document.getElementById('qrStatus');
  var qrBox = document.getElementById('qrBox');
  function pollQr(){
    if (!qrStatus || !qrBox) return;
    fetch('/qr').then(function(r){ return r.json(); }).then(function(d){
      if (d.connected && d.me) {
        qrStatus.innerHTML = '<span class="badge ok">✅ Connected</span><p style="font-size:18px;margin:8px 0;">'+ (d.me||'') +'</p>';
        qrBox.innerHTML = '';
      } else if (d.qrDataURL) {
        qrStatus.innerHTML = '<span class="badge wait">QR active — scan karo</span>';
        qrBox.innerHTML = '<img src="'+d.qrDataURL+'" alt="QR"><p style="color:#9aa0aa;">WhatsApp &gt; Linked devices &gt; Link a device</p>';
      } else {
        qrStatus.innerHTML = '<span class="badge wait">⏳ Connecting… QR generate hone ka wait</span>';
      }
    }).catch(function(){});
  }
  pollQr();
  setInterval(pollQr, 4000);
})();
</script>`);
}

export function makeAdminPanelRouter(getQrState) {
  router.get('/', async (req, res) => {
    if (!isAuthed(req)) return res.send(loginPage());
    const settings = await getSettings();
    const qrState = getQrState ? getQrState() : {};
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
