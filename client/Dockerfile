# syntax=docker/dockerfile:1
# Built from the repo root (see docker-compose.yml) because game/defs.ts imports ../shared/defs.

# --- Build stage: compile TypeScript and bundle with Vite ---
FROM node:22-alpine AS build
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
# npm's download cache survives lockfile changes, so only new packages are fetched.
RUN --mount=type=cache,id=top-down-survival-npm,target=/root/.npm npm ci
COPY shared /src/shared
COPY client .
RUN npm run build

# --- Runtime stage: serve the static build with nginx ---
FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/client/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
