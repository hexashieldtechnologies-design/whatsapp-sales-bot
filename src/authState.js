// authState.js — Mongo-backed Baileys AuthenticationState.
// Mirrors use-multi-file-auth-state's contract but persists to MongoDB so the
// session survives Railway redeploys. Uses initAuthCreds() for a valid fresh
// session and BufferJSON for (de)serialization.
import { col } from './db.js';
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const SESSION_ID = 'default';

let creds = null;
let keys = {};

// Serialize an object tree for Mongo storage (Buffers -> {type:'Buffer',data}).
function serialize(obj) {
  return JSON.parse(JSON.stringify(obj, BufferJSON.replacer));
}

// Deserialize an object tree read from Mongo back with Buffers revived.
function deserialize(obj) {
  if (obj == null) return obj;
  return JSON.parse(JSON.stringify(obj), BufferJSON.reviver);
}

async function loadState() {
  const doc = await col('whatsapp_sessions').findOne({ _id: SESSION_ID });
  if (doc && doc.creds) {
    creds = deserialize(doc.creds);
    keys = deserialize(doc.keys || {});
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
    { $set: { creds: serialize(creds), keys: serialize(keys), updatedAt: new Date() } },
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
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = keys[`${type}_${id}`];
            if (value != null) {
              if (type === 'app-state-sync-key') {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              } else {
                value = deserialize(value);
              }
              data[id] = value;
            }
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}_${id}`;
              if (value) {
                keys[key] = serialize(value);
              } else {
                delete keys[key];
              }
            }
          }
          await persistState();
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
