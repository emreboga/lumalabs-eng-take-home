FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./

COPY packages/shared/package*.json ./packages/shared/
COPY packages/agent/package*.json ./packages/agent/

RUN npm ci

COPY packages/shared ./packages/shared
RUN npm run build --workspace=packages/shared

COPY packages/agent ./packages/agent
RUN npm run build --workspace=packages/agent

# --- Runtime image ---
# Alpine 3.19+ ships Git 2.43 which is required for GIT_AUTHORIZATION_TOKEN support (added in Git 2.41)
FROM node:20-alpine3.19
WORKDIR /app

# git for clone/branch/push operations
RUN apk add --no-cache git

# Claude Code CLI — used to generate plans and implement code
RUN npm install -g @anthropic-ai/claude-code

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/agent/package*.json ./packages/agent/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist

CMD ["node", "packages/agent/dist/index.js"]
