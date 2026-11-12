# Build stage
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Production stage
FROM node:20-slim
WORKDIR /app

# Install dependencies for sharp (libvips)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/dist/lists/*

COPY --from=builder /app/package*.json ./
RUN npm install --only=production

COPY --from=builder /app/api ./api
COPY --from=builder /app/public ./public

# Set production env
ENV NODE_ENV=production
ENV PORT=3002

EXPOSE 3002

CMD ["node", "api/index.js"]
