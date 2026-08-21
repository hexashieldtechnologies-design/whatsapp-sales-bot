import { MongoClient } from 'mongodb';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let client = null;
let db = null;

export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set. Add it to your .env / Railway env variables.');
  }
  client = new MongoClient(uri, {});
  await client.connect();
  db = client.db();
  logger.info('MongoDB connected');

  try {
    await db.collection('conversations').createIndex({ lastActive: -1 });
    await db.collection('whatsapp_sessions').createIndex({ key: 1 }, { unique: true });
  } catch (e) {
    logger.warn({ err: e.message }, 'index creation warning');
  }
  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized. Call connectDB() first.');
  return db;
}

export function col(name) {
  return getDb().collection(name);
}

export const SETTINGS_ID = 'settings';

export const MODEL_LISTS = {
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it',
    'qwen-2.5-32b',
    'mixtral-8x7b-32768',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ],
  openrouter: [
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-nano-9b-v2:free',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat',
    'qwen/qwen-2.5-72b-instruct',
    'openai/gpt-4o-mini',
  ],
};

export const DEFAULT_SETTINGS = {
  aiProvider: process.env.AI_PROVIDER || 'openrouter',
  groqApiKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  openrouterApiKey: '',
  openrouterModel: 'google/gemma-4-26b-a4b-it:free',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  ownerWhatsappNumber: '',
  adminNumbers: '',
  ownerTraining: '',
  blockedNumbers: '',
  pausedNumbers: '',
  notifyWebhookUrl: '',
  botPaused: false,
};

export async function getSettings() {
  const c = col('settings');
  const doc = await c.findOne({ _id: SETTINGS_ID });
  if (!doc) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...doc };
}

export async function saveSettings(patch) {
  const c = col('settings');
  await c.updateOne(
    { _id: SETTINGS_ID },
    { $set: patch, $setOnInsert: { _id: SETTINGS_ID } },
    { upsert: true }
  );
  return getSettings();
}

export default { connectDB, getDb, col, getSettings, saveSettings, DEFAULT_SETTINGS, MODEL_LISTS };
