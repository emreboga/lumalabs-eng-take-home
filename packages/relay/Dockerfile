FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace root config
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy package manifests for all packages
COPY packages/shared/package*.json ./packages/shared/
COPY packages/relay/package*.json ./packages/relay/

# Install all workspace dependencies
RUN npm ci

# Build shared first, then relay
COPY packages/shared ./packages/shared
RUN npm run build --workspace=packages/shared

COPY packages/relay ./packages/relay
RUN npm run build --workspace=packages/relay

# --- Runtime image ---
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/relay/package*.json ./packages/relay/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/relay/dist ./packages/relay/dist

EXPOSE 3000
CMD ["node", "packages/relay/dist/index.js"]
