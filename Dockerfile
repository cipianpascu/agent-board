# Build stage
FROM node:22-slim AS build

# Native modules (better-sqlite3) need build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Remove dev dependencies after the build
RUN npm prune --production

# Production stage
FROM node:22-slim

ENV NODE_ENV=production

# Create a non-root user and group
RUN groupadd -r appgroup && useradd -r -g appgroup -s /sbin/nologin appuser

WORKDIR /app

# Copy the packaged application
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dashboard ./dashboard
COPY --from=build /app/templates ./templates
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json

# The application should not need to write to the image filesystem in production.
# Writable directories (/tmp, /app/data) are mounted as emptyDir volumes in Kubernetes.
USER appuser

EXPOSE 3456 3457

CMD ["node", "dist/index.js"]
