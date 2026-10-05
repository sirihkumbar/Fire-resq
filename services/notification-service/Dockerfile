FROM node:20-slim

WORKDIR /app

# Copy root proto definitions if needed
COPY shared/proto ./shared/proto

WORKDIR /app/services/notification-service
COPY services/notification-service/package*.json ./
RUN npm install

COPY services/notification-service ./

CMD ["npm", "run", "dev"]