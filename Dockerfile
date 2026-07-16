FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
# server/dist e web/dist precisam ficar como irmãos (mesma relação de pastas do repo local),
# porque index.ts resolve web/dist com um caminho relativo (../../web/dist a partir de si mesmo).
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=server-build /app/server/dist ./dist
COPY --from=web-build /app/web/dist /app/web/dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
