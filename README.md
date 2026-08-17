# WhatsApp AI Sales Bot

A WhatsApp-based AI sales assistant built with **Node.js + Baileys + Express + MongoDB**, deployed on **Railway**.

Deploy it, scan a QR to link a WhatsApp number, and every customer who messages that number is handled by an AI agent that:

- talks naturally in **Hinglish** (Hindi-English mix)
- pulls **live product data** from your external product API
- **remembers each customer** separately (own history + profile notes)
- asks discovery questions before recommending
- **escalates to you (the owner)** on request with full context
- never uses abusive language and never fabricates claims

It also has a full **admin control layer** — you manage the bot entirely by messaging it (add products, broadcast to customers, set live rules), no dashboard needed.

---

## 1. Prerequisites

- A [Railway](https://railway.app) account
- A MongoDB Atlas cluster (free M0 tier is fine)
- API key for one AI provider: **Groq** (default), **Google AI Studio (Gemini)**, or **OpenRouter**

---

## 2. Deploy to Railway

1. Push this repo to GitHub (or connect your local folder).
2. In Railway, **New Project → Deploy from GitHub repo** (or use the Railway CLI).
3. Add these **environment variables**:

   | Variable | Value |
   |---|---|
   | `MONGO_URI` | your Atlas connection string |
   | `PORT` | `3000` (Railway may set this automatically) |
   | `QR_PASSWORD` | any secret token, e.g. `supersecret123` |
   | `AI_PROVIDER` | `groq` (optional — overridden by `/settings`) |
   | `IMAGE_HOST` | optional: `cloudinary` (leave blank to skip images) |

   > `MONGO_URI` looks like: `mongodb+srv://<user>:<pass>@cluster0.xxx.mongodb.net/?appName=Cluster0`

4. Railway auto-detects the `Dockerfile` and deploys.

---

## 3. Link your WhatsApp number

1. Open `https://<your-railway-url>/qr?token=<QR_PASSWORD>`.
2. Scan the QR with **WhatsApp → Settings → Linked devices → Link a device**.
3. When connected, the page shows **"✅ Connected as +91…"**.

The session is stored in MongoDB, so redeploys/restarts do **not** require re-scanning.

---

## 4. Configure the bot

Open `https://<your-railway-url>/settings` and fill in:

- Shop / business name
- Owner WhatsApp number (where escalations go)
- Admin numbers (comma-separated)
- Product API URL (GET → JSON array)
- AI provider + API key + model

Everything is saved to MongoDB and takes effect immediately — no redeploy.

---

## 5. Admin control (messing the bot)

Message the bot from an **admin number**. Type `menu` to see options:

- **Add product** — via text, photo, or voice note.
- **Broadcast** — message all recent customers (throttled).
- **Set a rule** — injected into every future customer reply.

Every destructive action is confirmed before it happens.

---

## 6. Project structure

```
src/
├── index.js            # entry point
├── config.js           # settings + admin-number helpers
├── db.js               # Mongo connection + settings
├── authState.js        # Mongo-backed session persistence
├── ai.js               # provider-agnostic AI (text + vision + JSON)
├── productCatalog.js   # catalog fetch + cache + merge
├── media.js            # voice transcription + image hosting
├── messenger.js        # inbound pipeline
├── admin.js            # admin dispatcher
├── prompts.js          # system prompt + guardrails
├── flows/              # onboarding, sales, escalation, addProduct, broadcast, rules
└── routes/             # qr, settings, health
```

---

## 7. Safety notes

- **WhatsApp ban risk**: broadcasts are throttled (2–5s delays) and target only recently-active customers.
- **Admin mode gated solely by phone number.**
- **Secrets**: put real keys in `.env` (gitignored). Never commit `.env`.
