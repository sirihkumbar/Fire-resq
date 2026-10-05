FROM node:20-slim

# Install OpenSSL for Prisma engine binary compatibility
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root proto definitions
COPY shared/proto ./shared/proto

# Setup service directory
WORKDIR /app/services/incident-service
COPY services/incident-service/package*.json ./
COPY services/incident-service/prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY services/incident-service ./

EXPOSE 50051
CMD ["npm", "run", "dev"]