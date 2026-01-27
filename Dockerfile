FROM node:18-alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create output directory
RUN mkdir -p /usr/src/app/output

EXPOSE 3000

CMD ["npm", "start"]