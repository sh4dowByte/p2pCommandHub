FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package configuration
COPY package*.json ./

# Install dependencies (including production dependencies)
RUN npm install

# Copy application files
COPY server.js ./
COPY public/ ./public/
COPY client-python/ ./client-python/
COPY client-bash/ ./client-bash/

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
