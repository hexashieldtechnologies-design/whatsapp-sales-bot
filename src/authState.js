// authState.js — Mongo-backed Baileys AuthenticationState.
// Baileys expects an object with { creds, keys } where each has an async get()
// returning the current value and set() persisting a new value. We store the
// whole session as serialized JSON under a single "whatsapp_sessions" document
// so it survives Railway's ephemeral filesystem across redeploys.
import { col } from './db.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const SESSION_ID = 'default';

// The on-disk (Mongo) representation of a Baileys auth state.
const emptyState = {
  creds: { signedIdentityKey: null, registrationId: 0, advSecretKey: null, nextPrekeyId: 1, firstUnuploadedPrekeyId: 1, account: null, me: null, signalIdentities: [] },
  keys: {},
};

let cachedState = null;

async function loadState() {
  if (cachedState) return cachedState;
  const doc = await col('whatsapp_sessions').findOne({ _id: SESSION_ID });
  cachedState = doc ? doc.state : { ...emptyState };
  return cachedState;
}

async function persistState() {
  if (!cachedState) return;
  await col('whatsapp_sessions').updateOne(
    { _id: SESSION_ID },
    { $set: { state: cachedState, updatedAt: new Date() } },
    { upsert: true }
  );
}

export function hasSession() {
  return cachedState && cachedState.creds && cachedState.creds.me;
}

export async function clearSession() {
  cachedState = { ...emptyState };
  await col('whatsapp_sessions').deleteOne({ _id: SESSION_ID });
  logger.warn('session cleared from Mongo');
}

// Small debounced persister to avoid writing on every single key update.
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; persistState().catch((e) => logger.error({ err: e.message }, 'save session failed')); }, 300);
}

function makeStore(getter, setter) {
  return {
    async get() { const st = await loadState(); return getter(st); },
    set(value) { setter(cachedState || (cachedState = { ...emptyState }), value); scheduleSave(); },
  };
}

export async function useMongoAuthState() {
  await loadState();
  return {
    state: {
      creds: makeStore((st) => st.creds, (st, v) => { st.creds = v; }),
      keys: makeStore((st) => st.keys, (st, v) => { st.keys = v; }),
    },
    saveCreds: async () => { await persistState(); },
  };
}

// Flush any pending writes (call before shutdown).
export async function flushAuthState() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await persistState();
}

export default { useMongoAuthState, clearSession, hasSession, flushAuthState };
