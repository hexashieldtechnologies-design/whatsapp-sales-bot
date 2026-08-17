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
    await db.collection('broadcasts').createIndex({ createdAt: -1 });
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
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'qwen/qwen3.6-27b',
    'allam-2-7b',
    'groq/compound',
    'groq/compound-mini',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash-thinking-exp-01-21',
  ],
  openrouter: [
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat',
    'qwen/qwen-2.5-72b-instruct',
    'openai/gpt-4o-mini',
  ],
};

export const DEFAULT_SETTINGS = {
  businessName: 'Our Store',
  shopAddress: '',
  shopWebsite: '',
  shopLocation: '',
  productApiUrl: '',
  productApiCreateUrl: '',
  aiProvider: process.env.AI_PROVIDER || 'groq',
  groqApiKey: '',
  groqModel: 'openai/gpt-oss-20b',
  groqVisionModel: 'openai/gpt-oss-20b',
  openrouterApiKey: '',
  openrouterModel: 'google/gemma-4-31b-it:free',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  ownerWhatsappNumber: '',
  adminNumbers: '',
  broadcastWindowDays: 45,
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
