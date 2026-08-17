// index.js — application entry point. Boots Express + Baileys, wires QR page,
// settings page, health, pairing-code flow, and the message pipeline.
import 'dotenv/config';
import pino from 'pino';
import express from 'express';
import cookieParser from 'cookie-parser';
import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import { connectDB, getSettings } from './db.js';
import { useMongoAuthState, clearSession, flushAuthState } from './authState.js';
import { handleInbound } from './messenger.js';
import makeAdminPanelRouter from './routes/adminPanel.js';
import makeHealthRouter from './routes/health.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = process.env.PORT || 3000;

const conn = {
  qr: null,
  connected: false,
  me: null,
  pairingCode: null,
};

let sock = null;

function disconnectStatusCode(lastDisconnect) {
  return lastDisconnect?.error?.output?.statusCode
    ?? lastDisconnect?.error?.statusCode
    ?? lastDisconnect?.statusCode;
}

async function startSock(settings) {
  const { state, saveCreds } = await useMongoAuthState();

  sock = makeWASocket({
    auth: state,
    logger,
    browser: ['WhatsApp Sales Bot', 'Chrome', '1.0.0'],
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      conn.qr = qr;
      conn.connected = false;
    }

    if (connection === 'open') {
      conn.connected = true;
      conn.qr = null;
      conn.pairingCode = null;
      try {
        conn.me = sock.user?.id ? `${sock.user.id.split(':')[0]}@s.whatsapp.net` : null;
        logger.info('✅ WhatsApp connected as %s', conn.me || 'unknown');
      } catch (e) {
        logger.error({ err: e.message }, 'read own id failed');
      }
    }

    if (connection === 'close') {
      conn.connected = false;
      const statusCode = disconnectStatusCode(lastDisconnect);
      logger.warn({ statusCode }, 'connection closed, reconnecting');

      if (statusCode === DisconnectReason.loggedOut) {
        logger.warn('logged out — clearing session, will regenerate QR');
        await clearSession();
        await flushAuthState();
      }

      setTimeout(() => {
        startSock(settings).catch((e) => logger.error({ err: e.message }, 'reconnect failed'));
      }, 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const s = await getSettings();
      for (const m of messages) {
        if (m.key && m.key.fromMe) continue;
        await handleInbound(sock, m, s);
      }
    } catch (e) {
      logger.error({ err: e.message }, 'message handling error');
    }
  });

  return sock;
}

async function main() {
  await connectDB();
  const settings = await getSettings();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  const getQrState = () => ({ qr: conn.qr, connected: conn.connected, me: conn.me, pairingCode: conn.pairingCode });

  app.get('/qr', async (req, res) => {
    try {
      const data = {
        connected: conn.connected,
        me: conn.me,
        qrDataURL: null,
      };
      if (!conn.connected && conn.qr) {
        data.qrDataURL = await qrcode.toDataURL(conn.qr);
      }
      return res.json(data);
    } catch (e) {
      logger.error({ err: e.message }, 'qr endpoint error');
      return res.json({ connected: conn.connected, me: conn.me, qrDataURL: null });
    }
  });

  app.post('/pair', async (req, res) => {
    try {
      const phone = String(req.body.phone || '').trim().replace(/[^0-9]/g, '');
      if (!phone) {
        return res.json({ ok: false, error: 'Phone number required (with country code, e.g. 919812345678).' });
      }
      if (!sock || typeof sock.requestPairingCode !== 'function') {
        return res.json({ ok: false, error: 'Pairing not available yet. Try again in a few seconds, or scan the QR.' });
      }
      const code = await sock.requestPairingCode(phone);
      conn.pairingCode = code;
      logger.info('pairing code requested for %s -> %s', phone, code);
      return res.json({ ok: true, code });
    } catch (e) {
      logger.error({ err: e.message }, 'pairing code request failed');
      return res.json({ ok: false, error: e.message });
    }
  });

  app.use('/', makeAdminPanelRouter(getQrState));
  app.use('/health', makeHealthRouter(getQrState));

  await startSock(settings);

  app.listen(PORT, () => {
    logger.info('HTTP server listening on :%s', PORT);
    logger.info('  /         → admin panel (QR + pairing + settings, password-protected)');
    logger.info('  /health   → status endpoint');
  });
}

main().catch((e) => {
  logger.error({ err: e.message, stack: e.stack }, 'fatal startup error');
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await flushAuthState().catch(() => {});
    process.exit(0);
  });
}
