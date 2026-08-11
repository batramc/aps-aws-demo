# APS on AWS — container image for AWS App Runner
# Small, production-ish Node image. App Runner pulls this from ECR and runs it.
FROM node:20-alpine

# App Runner routes traffic to this port; server.js reads process.env.PORT
ENV PORT=8080
ENV NODE_ENV=production

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# App source (node_modules, .env, .git excluded via .dockerignore)
COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
