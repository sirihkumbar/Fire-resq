FROM node:20-slim

WORKDIR /app

# Copy root proto definitions
COPY shared/proto ./shared/proto

# Setup service directory
WORKDIR /app/services/gateway
COPY services/gateway/package*.json ./
RUN npm install

COPY services/gateway ./

EXPOSE 4000
CMD ["npm", "run", "dev"]