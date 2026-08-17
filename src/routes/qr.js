// /qr — protected QR pairing page.
import express from 'express';
import qrcode from 'qrcode';

const router = express.Router();

export function makeQrRouter(getQrState) {
  router.get('/', async (req, res) => {
    // Protect with QR_PASSWORD; fallback to 'dev' if unset.
    const pass = process.env.QR_PASSWORD || 'dev';
    if (pass) {
      const token = req.query.token || req.headers['x-qr-token'];
      if (token !== pass) {
        res.status(401).send('Unauthorized. Add ?token=<QR_PASSWORD> to the URL.');
        return;
      }
    }

    const state = getQrState ? getQrState() : {};

    if (state.connected && state.me) {
      res.send(`<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp Bot</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}</style>
</head><body><div style="text-align:center;padding:32px;background:#1a1d24;border:1px solid #2a2e37;border-radius:12px;">
<div style="font-size:40px;">✅</div><h1 style="font-size:20px;margin:12px 0 4px;">Connected</h1>
<p style="color:#9aa0aa;">WhatsApp number: ${state.me}</p></div></body></html>`);
      return;
    }

    if (state.qr) {
      let img = '';
      try { img = await qrcode.toDataURL(state.qr); } catch (e) { img = ''; }
      res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Scan QR</title>
<meta http-equiv="refresh" content="4">
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.box{text-align:center;padding:32px;background:#1a1d24;border:1px solid #2a2e37;border-radius:12px;max-width:380px;}
img{width:280px;height:280px;border-radius:10px;background:#fff;padding:8px;}
h1{font-size:20px;margin:0 0 4px;} p{color:#9aa0aa;font-size:14px;}
.spin{color:#2563eb;margin-top:12px;}</style></head><body><div class="box">
<h1>📱 Scan to connect</h1><p>WhatsApp &gt; Linked devices &gt; Link a device</p>
${img ? `<img src="${img}" alt="QR">` : '<p class="spin">QR loading…</p>'}
<p class="spin">Page auto-refreshes every few seconds…</p></div></body></html>`);
      return;
    }

    res.send('Waiting for WhatsApp connection… refresh this page.');
  });

  return router;
}

export default makeQrRouter;
