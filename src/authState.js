// authState.js — Mongo-backed Baileys AuthenticationState.
// Uses Baileys' own initAuthCreds() + BufferJSON serialization so a fresh
// session starts from valid credentials (avoids 'error in validating
// connection' loops). Session survives Railway redeploys via MongoDB.
import { col } from './db.js';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const SESSION_ID = 'default';

let creds = null;
let keys = {};

function toJSON(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (v && typeof v === 'object') {
      if (Buffer.isBuffer(v)) return { type: 'Buffer', data: v.toString('base64') };
      if (v.type === 'Buffer' && v.data) {
        let b = Buffer.from(v.data, 'base64');
        if (v.subType) b = Uint8Array.from(b);
        return BufferJSON.replacer(k, { type: v.type, data: b.toString('base64') });
      }
      return v;
    }
    return v;
  }));
}

async function loadState() {
  const doc = await col('whatsapp_sessions').findOne({ _id: SESSION_ID });
  if (doc && doc.creds && doc.keys) {
    creds = doc.creds;
    keys = doc.keys;
    logger.info('loaded existing WhatsApp session from Mongo');
  } else {
    creds = initAuthCreds();
    keys = {};
    logger.info('no saved session — initialized fresh credentials (new QR)');
  }
}

async function persistState() {
  await col('whatsapp_sessions').updateOne(
    { _id: SESSION_ID },
    { $set: { creds, keys, updatedAt: new Date() } },
    { upsert: true }
  );
}

export function hasSession() {
  return creds && creds.me;
}

export async function clearSession() {
  creds = initAuthCreds();
  keys = {};
  await col('whatsapp_sessions').deleteOne({ _id: SESSION_ID });
  logger.warn('session cleared from Mongo');
}

export async function useMongoAuthState() {
  await loadState();
  return {
    state: {
      creds: {
        get: () => creds,
        set: (v) => { creds = v; },
      },
      keys: {
        get: (type, ids) => {
          const key = `${type}_${ids.join('_')}`;
          return keys[key];
        },
        set: (data) => {
          for (const [k, v] of Object.entries(data)) keys[k] = v;
        },
      },
    },
    saveCreds: async () => { await persistState(); },
  };
}

export async function flushAuthState() {
  await persistState();
}

export default { useMongoAuthState, clearSession, hasSession, flushAuthState };
