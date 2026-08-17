# ---- build stage ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# ---- runtime stage ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

EXPOSE 3000
CMD ["node", "src/index.js"]
