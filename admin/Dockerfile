# syntax=docker/dockerfile:1
# Built from the repo root (see docker-compose.yml): the editor reuses ../client/src and ../shared/defs.

# --- Build stage: compile TypeScript and bundle with Vite ---
FROM node:22-alpine AS build
WORKDIR /src/admin
COPY admin/package.json admin/package-lock.json ./
RUN --mount=type=cache,id=boarded-up-npm,target=/root/.npm npm ci
COPY shared /src/shared
COPY client/src /src/client/src
COPY admin .
RUN npm run build

# --- Runtime stage: serve the static build with nginx ---
FROM nginx:1.27-alpine
COPY admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/admin/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
