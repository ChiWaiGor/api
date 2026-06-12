# syntax=docker/dockerfile:1

# ---- Builder: install all deps (incl. toolchain for the argon2 native addon),
#      generate the Prisma client, and compile TypeScript. ----
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
ENV HUSKY=0
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ---- Production dependencies: install only prod deps against the same musl
#      base so the argon2 binary is compatible with the runtime image. ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- Runtime: slim image, non-root, no build toolchain. ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Prod node_modules without the generated Prisma client...
COPY --from=prod-deps /app/node_modules ./node_modules
# ...then overlay the generated client + engines from the builder.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
