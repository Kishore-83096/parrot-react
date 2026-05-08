#!/bin/sh
set -eu

js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

parent_api_base_url="$(js_string "${VITE_PARENT_API_BASE_URL:-}")"
messenger_service_url="${VITE_MESSENGER_SERVICE_URL:-${MESSENGER_SERVICE_URL:-}}"
messenger_service_url="$(js_string "$messenger_service_url")"

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__PARROT_CONFIG__ = {
  VITE_PARENT_API_BASE_URL: "$parent_api_base_url",
  VITE_MESSENGER_SERVICE_URL: "$messenger_service_url"
};
EOF
