# Stage 1: Compile TypeScript (CI/CD runner, fast)
FROM node:20-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Production image (compiled better-sqlite3 + dist)
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY --from=build /app/dist/ ./dist/
VOLUME ["/app/data"]
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
CMD ["node", "dist/bot.js"]
