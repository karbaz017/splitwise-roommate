FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Ledger + receipts live here; mount a volume to persist them.
ENV DATA_DIR=/data NODE_ENV=production
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
