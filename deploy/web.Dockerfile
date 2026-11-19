# syntax=docker/dockerfile:1
# The web app (static build) served by Caddy, which also forwards /api/* to the detection service
# and gets an HTTPS certificate automatically when SITE_ADDRESS is a domain name.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca,required=false sh -c 'if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; npm ci --no-audit --no-fund'
COPY . .
# same origin as the site: no CORS, no mixed http/https
ENV VITE_DETECT_API=/api
RUN npm run build

FROM caddy:2
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
