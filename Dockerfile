FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_SYNC_URL
ARG VITE_SYNC_API_TOKEN
ENV VITE_SYNC_URL=$VITE_SYNC_URL
ENV VITE_SYNC_API_TOKEN=$VITE_SYNC_API_TOKEN

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
