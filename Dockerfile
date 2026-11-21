FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /app/uploads /app/data

# Persist these two paths on a volume in production.
VOLUME ["/app/uploads", "/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
