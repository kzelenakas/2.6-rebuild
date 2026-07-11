# UAD 3.6 QC app - single container: Express serves API + built React frontend.
# Build:  docker build -t uad36-qc .
# Run:    docker run -p 3000:3000 uad36-qc

# --- Stage 1: build the frontend ---------------------------------------------
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: build the server -----------------------------------------------
FROM node:22-slim AS server-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
RUN npm run build:server

# --- Stage 3: runtime ---------------------------------------------------------
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy compiled assets
COPY --from=server-builder /app/dist /app/dist
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy rules, schemas, and schemas combined XSDs
COPY rules /app/rules
COPY schemas /app/schemas
COPY GSE_UAD_3.6.0_v1.3_schema/Combined /app/GSE_UAD_3.6.0_v1.3_schema/Combined

ENV QC_DATA_DIR=/data/files/db \
    NODE_ENV=production \
    PORT=3000

VOLUME /data

EXPOSE 3000
CMD ["node", "dist/server.cjs"]
