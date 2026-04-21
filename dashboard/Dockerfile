FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev
RUN npx prisma generate

FROM node:20-alpine
WORKDIR /app
ENV PORT=8080
EXPOSE 8080
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
