// productCatalog.js — fetch the external catalog, cache it, and merge
// admin-added products from MongoDB (for when the external API is read-only).
import { col } from './db.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let cache = { data: null, fetchedAt: 0 };
const TTL_MS = 7 * 60 * 1000; // 7 minutes

export function invalidateCatalog() {
  cache = { data: null, fetchedAt: 0 };
}

async function fetchExternal(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('product API ' + res.status);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data.products || data.data || []);
  if (!Array.isArray(arr)) throw new Error('unexpected product API shape');
  return arr;
}

async function fetchAdminAdded() {
  try {
    return await col('admin_added_products').find({}).toArray();
  } catch (e) {
    logger.error({ err: e.message }, 'fetch admin products failed');
    return [];
  }
}

// Returns the merged catalog array (external + admin-added).
export async function getCatalog(settings) {
  const url = settings?.productApiUrl;
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < TTL_MS) {
    return merge(cache.data.external, await fetchAdminAdded());
  }

  let external = [];
  if (url) {
    try {
      external = await fetchExternal(url);
      cache = { data: { external }, fetchedAt: now };
      logger.info('catalog refreshed: %d items', external.length);
    } catch (e) {
      logger.error({ err: e.message }, 'catalog fetch failed');
      // keep serving last known cache if available, else empty
      if (cache.data) external = cache.data.external;
    }
  }
  return merge(external, await fetchAdminAdded());
}

function merge(external, adminAdded) {
  const seen = new Set();
  const out = [];
  for (const p of [...external, ...adminAdded]) {
    const key = p.id != null ? String(p.id) : JSON.stringify(p.product_name || p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// Product shape normalization: tolerate alternative field names from a real API.
export function normalizeProduct(p) {
  return {
    id: p.id ?? p.product_id ?? p.sku,
    product_name: p.product_name ?? p.name ?? p.title,
    category: p.category ?? p.product_category,
    brand: p.brand,
    specifications: p.specifications ?? p.specs ?? p.description,
    estimated_price_inr: p.estimated_price_inr ?? p.price ?? p.price_inr,
    image: p.image ?? p.image_url,
  };
}

export default { getCatalog, normalizeProduct, invalidateCatalog };
