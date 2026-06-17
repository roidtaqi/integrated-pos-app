FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY sync-server ./sync-server

ENV NODE_ENV=production

CMD ["npm", "run", "sync:server"]
