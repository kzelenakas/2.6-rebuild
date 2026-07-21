# UAD 2.6 QC app - single container: Express serves API + built React frontend.
# Build:  docker build -t uad26-qc .
# Run:    docker run -p 3000:3000 uad26-qc

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

# Python interpreter for supplemental_rules/ and collateral_risk/ subprocess engines
# (engine.ts spawns QC_PYTHON_BIN, defaulting to "python3" -- this image never had one).
# lxml is collateral_risk/resolve.py's field-resolution layer -- it uses local-name()
# XPath predicates that stdlib xml.etree.ElementTree can't do, not swappable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --break-system-packages lxml

COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy compiled assets
COPY --from=server-builder /app/dist /app/dist
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy rules, schemas, and schemas combined XSDs
COPY rules /app/rules
COPY schemas /app/schemas
COPY GSE_UAD_3.6.0_v1.3_schema/Combined /app/GSE_UAD_3.6.0_v1.3_schema/Combined

# Python subprocess rule engines
COPY uad26_supplemental_rules /app/uad26_supplemental_rules
COPY uad26_collateral_risk /app/uad26_collateral_risk

ENV QC_DATA_DIR=/data/files/db \
    NODE_ENV=production \
    PORT=3000

VOLUME /data

EXPOSE 3000
CMD ["node", "dist/server.cjs"]
