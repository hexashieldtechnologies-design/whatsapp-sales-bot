# WhatsApp AI Assistant

A natural, human-like, multilingual WhatsApp chatbot built with **Node.js + Baileys + Express + MongoDB**, deployed on **Railway**.

The bot replies in the same language and script the user writes in — Hindi (Devanagari or Roman), English, Telugu (script or Roman), and natural code-mixed forms. It keeps per-user conversation memory and escalates to a human only when the user explicitly asks.

---

## 1. Prerequisites

- A [Railway](https://railway.app) account
- A MongoDB Atlas cluster (free M0 tier is fine)
- API key for one AI provider: **OpenRouter** (default), **Groq**, or **Google AI Studio (Gemini)**

---

## 2. Deploy to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**.
3. Add environment variables:

   | Variable | Value |
   |---|---|
   | `MONGO_URI` | your Atlas connection string |
   | `PORT` | `3000` (Railway may set this) |
   | `ADMIN_PASSWORD` | panel password (default `dev`) |
   | `QR_PASSWORD` | optional secret for the `/qr` page |
   | `AI_PROVIDER` | `openrouter` (optional — overridden by the panel) |

4. Railway auto-detects the `Dockerfile` and deploys.

---

## 3. Link your WhatsApp number

1. Open your Railway URL (`/` admin panel, password-protected) to see the QR.
2. In WhatsApp: **Settings → Linked devices → Link a device**, and scan.
3. The session is stored in MongoDB, so redeploys/restarts do **not** require re-scanning. Pair with a phone number (no QR) is also supported from the panel.

---

## 4. Configure the bot

From the admin panel, set:

- **Owner WhatsApp number** — where human-handoff summaries go.
- **Admin numbers** — numbers that can control the bot via chat.
- **AI provider + API key + model** — OpenRouter / Groq / Gemini.
- **Owner training** (optional) — extra standing instructions.

---

## 5. Language behaviour

The bot replies in the language and script the user writes:

| User writes | Bot replies |
|---|---|
| `Hello, how are you?` | English |
| `नमस्ते, आप कैसे हैं?` | Hindi (Devanagari) |
| `Bhai kya kar rahe ho?` | Roman Hindi / Hinglish |
| `మీరు ఎలా ఉన్నారు?` | Telugu |
| `Nuvvu ela unnavu?` | Roman Telugu |

A bare `Hi` / `Hello` is answered with a short "who are you?" instead of a long generic intro.
