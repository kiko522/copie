FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
EXPOSE 8787
USER node

CMD ["node", "src/server.mjs"]
