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
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama-3.2-90b-vision-preview',
    'llama-3.2-11b-vision-preview',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash-thinking-exp-01-21',
  ],
  openrouter: [
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
    'meta-llama/llama-3.3-70b-instruct',
    'anthropic/claude-3.5-sonnet',
    'google/gemini-2.0-flash-001',
    'qwen/qwen-2.5-72b-instruct',
    'deepseek/deepseek-chat',
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
  groqModel: 'llama-3.3-70b-versatile',
  groqVisionModel: 'llama-3.2-90b-vision-preview',
  openrouterApiKey: '',
  openrouterModel: 'openai/gpt-4o-mini',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  ownerWhatsappNumber: '',
  adminNumbers: '',
  broadcastWindowDays: 45,
  ownerTraining: '',
  blockedNumbers: '',
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
