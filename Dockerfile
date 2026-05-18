FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN apt-get update && apt-get install -y python3 build-essential && \
    npm install --omit=dev && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
