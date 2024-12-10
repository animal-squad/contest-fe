# 1. Build stage
FROM node:18 AS builder

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./
COPY .npmrc ./

# Install dependencies
RUN npm ci

# Copy all source code
COPY . .

# Build the Next.js application
RUN npm run build

# 2. Production stage
FROM node:18 AS runner

# Set working directory
WORKDIR /app

# Copy only necessary files from the build stage
COPY --from=builder /app/.next /app/.next
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.npmrc ./
COPY --from=builder /app/.env.local ./

# Install production dependencies
RUN npm ci --production

# Start the application
CMD ["npm", "run", "start"]
