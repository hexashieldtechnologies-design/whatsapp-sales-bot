// index.js — application entry point. Boots Express + Baileys, wires QR page,
// settings page, health, and the message pipeline.
import 'dotenv/config';
import pino from 'pino';
import express from 'express';
import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { connectDB, getSettings } from './db.js';
import { useMongoAuthState, clearSession, flushAuthState } from './authState.js';
import { handleInbound } from './messenger.js';
import makeQrRouter from './routes/qr.js';
import makeHealthRouter from './routes/health.js';
import settingsRouter from './routes/settings.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = process.env.PORT || 3000;

// Shared connection state (exposed to the QR + health routes).
const conn = {
  qr: null,
  connected: false,
  me: null,
};

// Decode Baileys' Boom disconnect reason safely.
function disconnectStatusCode(lastDisconnect) {
  return lastDisconnect?.error?.output?.statusCode
    ?? lastDisconnect?.error?.statusCode
    ?? lastDisconnect?.statusCode;
}

async function startSock(settings) {
  const { state, saveCreds } = await useMongoAuthState();

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: true,
    browser: ['WhatsApp Sales Bot', 'Chrome', '1.0.0'],
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

      // reconnect after a short backoff
      setTimeout(() => {
        startSock(settings).catch((e) => logger.error({ err: e.message }, 'reconnect failed'));
      }, 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      // re-read settings each message so config changes are live
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

  app.use('/settings', settingsRouter);
  app.use('/qr', makeQrRouter(() => ({ qr: conn.qr, connected: conn.connected, me: conn.me })));
  app.use('/health', makeHealthRouter(() => ({ connected: conn.connected, me: conn.me })));

  app.get('/', (req, res) => res.redirect('/qr'));

  await startSock(settings);

  app.listen(PORT, () => {
    logger.info('HTTP server listening on :%s', PORT);
    logger.info('  /qr        → scan the pairing QR');
    logger.info('  /settings  → configure the bot');
  });
}

main().catch((e) => {
  logger.error({ err: e.message, stack: e.stack }, 'fatal startup error');
  process.exit(1);
});

// graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await flushAuthState().catch(() => {});
    process.exit(0);
  });
}
