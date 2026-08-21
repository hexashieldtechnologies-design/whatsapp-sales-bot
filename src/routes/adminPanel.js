// adminPanel.js — single protected page: password login, then QR + phone-number
// pairing, plus settings. QR auto-refreshes via client-side polling (no page
// reload). AI Provider section uses an Add-button flow with a providers list.
import express from 'express';
import { getSettings, saveSettings, MODEL_LISTS } from '../db.js';

const router = express.Router();

const COOKIE_NAME = 'wa_admin';
const FIELD_NAMES = [
  'aiProvider',
  'groqApiKey', 'groqModel',
  'openrouterApiKey', 'openrouterModel', 'geminiApiKey', 'geminiModel',
  'ownerWhatsappNumber', 'adminNumbers', 'ownerTraining',
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
 .addbtn{display:inline-block;background:#16a34a;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-size:14px;cursor:pointer;margin:4px 4px 0 0;}
 .addbtn:hover{background:#15803d;}
 .provrow{display:flex;align-items:center;justify-content:space-between;background:#13161c;border:1px solid #2a2e37;border-radius:8px;padding:10px 12px;margin:8px 0;}
 .provname{font-weight:600;font-size:14px;}
 .provmeta{font-size:12px;color:#9aa0aa;margin-top:2px;}
 .active{background:#12311f;color:#4ade80;padding:3px 9px;border-radius:12px;font-size:11px;margin-left:8px;}
 .remove{background:transparent;border:1px solid #dc2626;color:#dc2626;padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;}
 .remove:hover{background:#dc2626;color:#fff;}
 .use{background:#2563eb;color:#fff;border:0;padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;margin-right:6px;}
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

  const providers = [
    { key: 'groq', name: 'Groq', apiKey: settings.groqApiKey || '', model: settings.groqModel || '' },
    { key: 'gemini', name: 'Gemini', apiKey: settings.geminiApiKey || '', model: settings.geminiModel || '' },
    { key: 'openrouter', name: 'OpenRouter', apiKey: settings.openrouterApiKey || '', model: settings.openrouterModel || '' },
  ];
  const activeProvider = settings.aiProvider || 'groq';

  let provRows = '';
  for (const p of providers) {
    const keyCount = p.apiKey ? p.apiKey.split('\n').filter(Boolean).length : 0;
    const isActive = p.key === activeProvider;
    const meta = keyCount > 0 ? `${keyCount} key(s) • ${esc(p.model)}` : 'No key added';
    provRows += `<div class="provrow" data-provider="${p.key}">
<div><span class="provname">${p.name}${isActive ? '<span class="active">Active</span>' : ''}</span>
<div class="provmeta">${meta}</div></div>
<div>
${isActive ? '' : `<button type="button" class="use" data-activate="${p.key}">Use as active</button>`}
<button type="button" class="remove" data-remove="${p.key}">Remove</button>
</div></div>`;
  }

  return baseHtml(`
<h1>🤖 WhatsApp Assistant Bot</h1>
<p class="sub">QR ya phone number se connect karo (upar) + settings (neeche).</p>
${qrSection}
<form method="POST" action="/" id="settingsForm">
<input type="hidden" name="aiProvider" id="aiProviderHidden" value="${esc(activeProvider)}">
<div class="card"><h2>👤 Owner / Admin</h2>
<label>Owner WhatsApp number (human handoff + admin)</label><input name="ownerWhatsappNumber" value="${value('ownerWhatsappNumber')}" placeholder="91XXXXXXXXXX">
<label>Admin numbers (comma-separated)</label><input name="adminNumbers" value="${value('adminNumbers')}" placeholder="91XXXXXXXXXX,91YYYYYYYYYY">
</div>
<div class="card"><h2>🚫 Number Restriction (Blocklist)</h2>
<label>Blocked numbers (comma-separated)</label><input name="blockedNumbers" value="${value('blockedNumbers')}" placeholder="91XXXXXXXXXX,91YYYYYYYYYY">
</div>
<div class="card"><h2>🤖 AI Provider</h2>
<div id="providerList">${provRows || '<p style="color:#6b7280;">Koi provider add nahi hai.</p>'}</div>
<button type="button" class="addbtn" id="addProviderBtn">➕ Add Provider</button>
<div id="addProviderForm" class="hidden" style="margin-top:14px;padding-top:14px;border-top:1px solid #2a2e37;">
<label>Provider select karo</label>
<select id="addProviderSelect">
<option value="groq">Groq</option>
<option value="gemini">Gemini</option>
<option value="openrouter">OpenRouter</option>
</select>
<div id="addOpenrouterFields">
<label>OpenRouter API key</label>
<input type="text" id="addOpenrouterKey" placeholder="sk-or-...">
<label>Model (free model use karo)</label>
<select id="addOpenrouterModel">${mo(MODEL_LISTS.openrouter, settings.openrouterModel)}</select>
</div>
<div id="addGroqFields" class="hidden">
<label>Groq API key</label>
<input type="text" id="addGroqKey" placeholder="gsk_...">
<label>Groq model</label><select id="addGroqModel">${mo(MODEL_LISTS.groq, settings.groqModel)}</select>
</div>
<div id="addGeminiFields" class="hidden">
<label>Gemini API key</label>
<input type="text" id="addGeminiKey" placeholder="AIza...">
<label>Gemini model</label><select id="addGeminiModel">${mo(MODEL_LISTS.gemini, settings.geminiModel)}</select>
</div>
<button type="button" id="saveProviderBtn" style="background:#16a34a;">💾 Save Provider</button>
<div class="hint" style="margin-top:8px;">💡 Ek hi provider mein multiple keys ek line mein bhi daal sakte ho (newline se alag). Ek key fail/rate-limit ho to next key automatically use hoti hai (fallback).</div>
</div>
</div>
<div class="card"><h2>🔔 Notifications (optional)</h2>
<label>Notify webhook URL</label><input name="notifyWebhookUrl" value="${value('notifyWebhookUrl')}" placeholder="https://yourserver.com/hook">
</div>
<div class="card"><h2>🎓 Owner Training (optional)</h2>
<label>Apne bot ko kya sikhana hai?</label>
<textarea name="ownerTraining" placeholder="Bot ko ye batao ki kaise baat karni hai...">${value('ownerTraining')}</textarea>
</div>
<button type="submit">Save settings</button>
</form>
<form method="POST" action="/logout"><button type="submit" style="background:#dc2626;">Logout</button></form>`,
`<script>
(function(){
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

  var addProviderBtn = document.getElementById('addProviderBtn');
  var addProviderForm = document.getElementById('addProviderForm');
  var addProviderSelect = document.getElementById('addProviderSelect');
  function syncProviderFields(){
    var v = addProviderSelect.value;
    var gp = document.getElementById('addGroqFields');
    var gm = document.getElementById('addGeminiFields');
    var or = document.getElementById('addOpenrouterFields');
    if (gp) gp.classList.toggle('hidden', v !== 'groq');
    if (gm) gm.classList.toggle('hidden', v !== 'gemini');
    if (or) or.classList.toggle('hidden', v !== 'openrouter');
  }
  if (addProviderBtn && addProviderForm) {
    addProviderBtn.addEventListener('click', function(){ addProviderForm.classList.toggle('hidden'); });
  }
  if (addProviderSelect) {
    addProviderSelect.addEventListener('change', syncProviderFields);
    syncProviderFields();
  }

  function postProvider(payload){
    return fetch('/providers', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json(); });
  }
  function reloadPage(){ window.location.reload(); }

  var saveProviderBtn = document.getElementById('saveProviderBtn');
  if (saveProviderBtn) {
    saveProviderBtn.addEventListener('click', function(){
      var v = addProviderSelect.value;
      var payload = { provider: v };
      if (v === 'groq') {
        payload.apiKey = document.getElementById('addGroqKey').value;
        payload.model = document.getElementById('addGroqModel').value;
      } else if (v === 'gemini') {
        payload.apiKey = document.getElementById('addGeminiKey').value;
        payload.model = document.getElementById('addGeminiModel').value;
      } else {
        payload.apiKey = document.getElementById('addOpenrouterKey').value;
        payload.model = document.getElementById('addOpenrouterModel').value;
      }
      saveProviderBtn.disabled = true;
      saveProviderBtn.textContent = 'Saving...';
      postProvider(payload).then(function(d){
        if (d.ok) { reloadPage(); }
        else { alert(d.error || 'Error hua'); saveProviderBtn.disabled = false; saveProviderBtn.textContent = '💾 Save Provider'; }
      }).catch(function(){ reloadPage(); });
    });
  }

  document.addEventListener('click', function(e){
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-activate')) {
      postProvider({ provider: t.getAttribute('data-activate'), activateOnly: true }).then(function(d){
        if (d.ok) reloadPage(); else alert(d.error || 'Error');
      });
    }
    if (t && t.getAttribute && t.getAttribute('data-remove')) {
      if (confirm('Provider remove kare?')) {
        postProvider({ provider: t.getAttribute('data-remove'), remove: true }).then(function(d){
          if (d.ok) reloadPage(); else alert(d.error || 'Error');
        });
      }
    }
  });
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
    const settings = await saveSettings(patch);
    const qrState = getQrState ? getQrState() : {};
    res.send(await panelPage(settings, qrState, true));
  });

  router.post('/providers', async (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: 'Not authorized' });
    try {
      const provider = String(req.body.provider || '');
      const valid = ['groq', 'gemini', 'openrouter'];
      if (!valid.includes(provider)) return res.json({ ok: false, error: 'Invalid provider' });

      if (req.body.activateOnly) {
        await saveSettings({ aiProvider: provider });
        return res.json({ ok: true });
      }

      if (req.body.remove) {
        const patch = {};
        if (provider === 'groq') patch.groqApiKey = '';
        else if (provider === 'gemini') patch.geminiApiKey = '';
        else patch.openrouterApiKey = '';
        const s = await getSettings();
        if (s.aiProvider === provider) {
          const alt = valid.find((p) => p !== provider && (s[p === 'groq' ? 'groqApiKey' : p === 'gemini' ? 'geminiApiKey' : 'openrouterApiKey'] || '').trim());
          patch.aiProvider = alt || 'groq';
        }
        await saveSettings(patch);
        return res.json({ ok: true });
      }

      const apiKey = String(req.body.apiKey || '').trim();
      const model = String(req.body.model || '').trim();
      if (!apiKey) return res.json({ ok: false, error: 'API key required' });

      const patch = { aiProvider: provider };
      if (provider === 'groq') {
        patch.groqApiKey = apiKey;
        if (model) patch.groqModel = model;
      } else if (provider === 'gemini') {
        patch.geminiApiKey = apiKey;
        if (model) patch.geminiModel = model;
      } else {
        patch.openrouterApiKey = apiKey;
        if (model) patch.openrouterModel = model;
      }
      await saveSettings(patch);
      return res.json({ ok: true });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });

  router.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0`);
    res.redirect('/');
  });

  return router;
}

export default makeAdminPanelRouter;
