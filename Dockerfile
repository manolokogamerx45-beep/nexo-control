FROM node:24-bookworm-slim AS auth-api
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY lib ./lib
COPY scripts/create-admin.cjs ./scripts/create-admin.cjs
COPY server.cjs ./
# app.js stays behind the API's active-user authorization.
COPY dist ./dist
USER node
ENV HOST=0.0.0.0 PORT=4173
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4173/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.cjs"]

FROM nginx:stable-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/index.html dist/styles.css dist/auth.css dist/auth.js /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/health/web || exit 1
