FROM node:18-alpine

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install clean production dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
