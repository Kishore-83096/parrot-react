FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_PARENT_API_BASE_URL
ARG VITE_MESSENGER_SERVICE_URL
ARG MESSENGER_SERVICE_URL
RUN VITE_MESSENGER_SERVICE_URL="${VITE_MESSENGER_SERVICE_URL:-$MESSENGER_SERVICE_URL}" npm run build

FROM nginx:1.29-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/10-env-config.sh /docker-entrypoint.d/10-env-config.sh
RUN chmod +x /docker-entrypoint.d/10-env-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
