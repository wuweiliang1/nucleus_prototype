FROM node:22-alpine AS builder
WORKDIR /app

# Install & build frontend
COPY web/package*.json ./web/
RUN npm --prefix web ci
COPY web ./web
RUN npm --prefix web run build

# Install & build backend
COPY server/package*.json ./server/
RUN npm --prefix server ci
COPY server ./server
RUN npm --prefix server run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY server/package*.json ./server/
RUN npm --prefix server ci --omit=dev
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist

EXPOSE 8080
CMD ["node", "server/dist/index.js"]
