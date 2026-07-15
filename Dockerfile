FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package configuration
COPY package*.json ./

# Install dependencies (including production dependencies)
RUN npm install

# Copy application files
COPY server/ ./server/
COPY agents/ ./agents/

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server/server.js"]
