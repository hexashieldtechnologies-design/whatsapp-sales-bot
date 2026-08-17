// media.js — voice note transcription (Groq Whisper) and image handling for
// photo-based product adds. Images are hosted externally (Cloudinary/S3) when
// configured; otherwise no image URL is stored.
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Transcribe an audio buffer via Groq Whisper. Returns transcript text.
export async function transcribeAudio(buffer, mimeType, apiKey) {
  if (!apiKey) throw new Error('no Groq API key for transcription');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/ogg' }), 'audio.' + (mimeType?.includes('ogg') ? 'ogg' : 'ogg'));
  form.append('model', 'whisper-large-v3');
  form.append('language', 'hi');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('whisper ' + res.status + ': ' + t.slice(0, 200));
  }
  const data = await res.json();
  return (data.text || '').trim();
}

// Convert binary image buffer to a data URL.
export function bufferToDataUrl(buffer, mimeType = 'image/jpeg') {
  const b64 = Buffer.from(buffer).toString('base64');
  return `data:${mimeType};base64,${b64}`;
}

async function uploadCloudinary(dataUrl) {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !apiKey || !secret) throw new Error('Cloudinary not configured');

  const form = new FormData();
  form.append('file', dataUrl);
  form.append('upload_preset', ''); // unsigned; requires your preset or a signature
  form.append('api_key', apiKey);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error('cloudinary upload failed ' + res.status);
  const data = await res.json();
  return data.secure_url;
}

async function uploadS3(dataUrl) {
  // Simple S3 PUT via presigned-style is non-trivial without the AWS SDK; we
  // keep this a documented stub. For production S3, add `@aws-sdk/*` and a
  // bucket + credentials. Returns the public object URL if ENDPOINT is set.
  throw new Error('S3 upload not implemented in this build — configure IMAGE_HOST=cloudinary or leave unset');
}

// Upload a product image and return a public URL, or null if not configured.
export async function hostImage(dataUrl) {
  const host = process.env.IMAGE_HOST;
  if (!host) return null; // store no image
  try {
    if (host === 'cloudinary') return await uploadCloudinary(dataUrl);
    if (host === 's3') return await uploadS3(dataUrl);
    logger.warn('unknown IMAGE_HOST: %s', host);
    return null;
  } catch (e) {
    logger.error({ err: e.message }, 'image hosting failed');
    return null;
  }
}

export default { transcribeAudio, bufferToDataUrl, hostImage };
