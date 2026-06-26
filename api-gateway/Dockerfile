FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build && cp -r src/rate-limiter/lua dist/rate-limiter/lua

CMD ["node", "dist/main"]
