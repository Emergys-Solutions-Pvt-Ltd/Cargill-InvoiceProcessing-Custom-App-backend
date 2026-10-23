# syntax=docker/dockerfile:1
# Cargill Custom Apps API - Node.js 22 / Express / TypeScript
#   docker build -t cargill-custom-apps-api .
#   docker run --env-file .env -p 4000:4000 cargill-custom-apps-api

ARG NODE_VERSION=22

# ---- build: compile TypeScript ----
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- deps: production dependencies only ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE_DIR=storage/attachments
WORKDIR /app

COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Invoice PDFs referenced by invoice_attachments.storage_path (mount a volume here for real uploads)
COPY --chown=node:node storage ./storage

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
