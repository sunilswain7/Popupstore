FROM node:20-alpine AS deps
WORKDIR /app
COPY storefront/package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV PORT=8080
EXPOSE 8080
COPY --from=deps /app/node_modules ./node_modules
COPY storefront/ .
CMD ["node", "server.js"]
