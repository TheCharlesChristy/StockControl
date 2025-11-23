# Frontend Dockerfile for Development
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application code
COPY . .

# Expose Vite default port
EXPOSE 5173

# Command to run the development server with hot-reloading
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
