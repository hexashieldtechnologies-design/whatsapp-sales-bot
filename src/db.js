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
  db = client.db(); // uses the DB name encoded in the connection string, or "test"
  logger.info('MongoDB connected');

  // Recommended indexes
  try {
    await db.collection('conversations').createIndex({ lastActive: -1 });
    await db.collection('whatsapp_sessions').createIndex({ key: 1 }, { unique: true });
    await db.collection('broadcasts').createIndex({ createdAt: -1 });
  } catch (e) {
    logger.warn({ err: e.message }, 'index creation warning');
  }
  return db;
}

// Central accessor for collections
export function getDb() {
  if (!db) throw new Error('DB not initialized. Call connectDB() first.');
  return db;
}

export function col(name) {
  return getDb().collection(name);
}

// ---------------------------------------------------------------------------
// Settings: a single document { _id: "settings", ... } holding runtime config.
// ---------------------------------------------------------------------------
export const SETTINGS_ID = 'settings';

export const DEFAULT_SETTINGS = {
  businessName: 'Our Store',
  productApiUrl: '',
  productApiCreateUrl: '', // optional POST endpoint for writes; empty => use Mongo collection
  aiProvider: process.env.AI_PROVIDER || 'groq',
  groqApiKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  groqVisionModel: 'llama-3.2-90b-vision-preview',
  openrouterApiKey: '',
  openrouterModel: 'openai/gpt-4o-mini',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  ownerWhatsappNumber: '',
  adminNumbers: '', // comma-separated; first defaults to owner number
  broadcastWindowDays: 45,
};

export async function getSettings() {
  const c = col('settings');
  const doc = await c.findOne({ _id: SETTINGS_ID });
  if (!doc) return { ...DEFAULT_SETTINGS };
  // merge with defaults so newly-added keys always exist
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

export default { connectDB, getDb, col, getSettings, saveSettings };
