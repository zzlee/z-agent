FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./

RUN npm ci

COPY server/ ./server/
COPY web/ ./web/
COPY data/ ./data/

RUN npm run build

# 只拷貝執行所需要的檔案以縮減映像檔大小
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web ./web
COPY --from=builder /app/data ./data

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "run", "start"]
