FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV production
ENV NEXT_PUBLIC_APP_ENV production
ENV NEXT_PUBLIC_APP_VERSION 0.1.5
ENV NEXT_PUBLIC_APP_BUILD 2026.05.09-prod
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# [SOVEREIGN RUNTIME] Install Python and Font Engineering Tools
RUN apk add --no-cache python3 py3-pip brotli-dev gcc musl-dev python3-dev \
    && python3 -m venv /opt/venv \
    && . /opt/venv/bin/activate \
    && pip install --no-cache-dir fonttools brotli zopfli \
    && apk del gcc musl-dev python3-dev

ENV PATH="/opt/venv/bin:$PATH"
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# [ARTIFACTS] Copy essential runtime artifacts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tools ./tools

# [NETWORK]
EXPOSE 3000
ENV PORT 3000

CMD ["npm", "run", "start"]
