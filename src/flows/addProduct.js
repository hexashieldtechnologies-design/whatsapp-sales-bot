// addProduct.js — admin adds a product via text/photo/voice.
import { col } from '../db.js';
import { aiConfig } from '../config.js';
import { extractJSON } from '../ai.js';
import { invalidateCatalog } from '../productCatalog.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    product_name: { type: 'string' },
    category: { type: 'string' },
    brand: { type: 'string' },
    specifications: { type: 'string' },
    estimated_price_inr: { type: 'string' },
  },
};

export async function parseProduct(text, settings) {
  const cfg = aiConfig(settings);
  const prompt = `Extract product details. Return JSON with keys: product_name, category, brand, specifications, estimated_price_inr (string). Leave empty if unknown. Message: """${text}"""`;
  return extractJSON(PRODUCT_SCHEMA, prompt, cfg);
}

export function previewProduct(p) {
  return `Ye add karu?\n📦 ${p.product_name || '(no name)'}\nCategory: ${p.category || '?'} | Brand: ${p.brand || '?'}\nSpecs: ${p.specifications || '?'}\nPrice: ₹${p.estimated_price_inr || '?'}\n\nReply 'haan' ya 'sahi karo' agar confirm hai, warna 'nahi'.`;
}

export async function saveProduct(product, settings, imageUrl = null) {
  const { normalizeProduct } = await import('../productCatalog.js');
  const normalized = normalizeProduct({ ...product, image: imageUrl });

  if (settings.productApiCreateUrl) {
    try {
      const res = await fetch(settings.productApiCreateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized),
      });
      if (res.ok) { invalidateCatalog(); return '✅ Product external catalog mein add ho gaya.'; }
      logger.warn('external create failed %d — falling back to DB', res.status);
    } catch (e) {
      logger.warn({ err: e.message }, 'external create error — falling back to DB');
    }
  }

  normalized._id = normalized.id != null ? String(normalized.id) : (crypto?.randomUUID?.() ?? Date.now().toString());
  normalized.createdAt = new Date();
  await col('admin_added_products').updateOne({ _id: normalized._id }, { $set: normalized }, { upsert: true });
  invalidateCatalog();
  return '✅ Product DB mein add ho gaya (catalog read hone par merge hoga).';
}

export async function deleteAllProducts() {
  const r = await col('admin_added_products').deleteMany({});
  invalidateCatalog();
  return `🗑️ ${r.deletedCount} products delete ho gaye. Catalog ab khali hai (external API products unaffected).`;
}

export default { parseProduct, previewProduct, saveProduct, deleteAllProducts };
