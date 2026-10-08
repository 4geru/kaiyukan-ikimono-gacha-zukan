# syntax=docker/dockerfile:1.7

# ベースイメージはダイジェストで固定（#832 C9）。更新時: docker buildx imagetools inspect node:<tag> の Digest に差し替える
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS runtime

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --omit=dev \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/app --shell /usr/sbin/nologin app

COPY --chown=10001:10001 data ./data
COPY --from=builder --chown=10001:10001 /app/dist ./dist

ENV HOME=/home/app \
    PORT=8080 \
    HOST=0.0.0.0
EXPOSE 8080

USER 10001:10001
CMD ["node", "dist/server.js"]
