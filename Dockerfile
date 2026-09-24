# syntax=docker/dockerfile:1.7
# Multi-stage: la imagen final no lleva compilador, devDependencies ni codigo fuente.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# distroless: sin shell ni gestor de paquetes. Reduce la superficie de ataque
# y evita que un RCE tenga con que moverse lateralmente.
FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=768"

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

# nonroot: nunca ejecutar como uid 0 (CIS Docker Benchmark 4.1).
USER 65532:65532
EXPOSE 3000

# El healthcheck real lo hace Kubernetes; este cubre docker-compose.
CMD ["dist/server.js"]
