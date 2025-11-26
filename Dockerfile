# Use Playwright's official image which includes all browser dependencies
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Run migrations and start server
CMD ["sh", "-c", "NODE_ENV=production npm run db:migrate:prod && NODE_ENV=production npm start"]
