#!/usr/bin/env bash
set -euo pipefail

read_secret() {
  local variable="$1"
  local path="$2"
  local value
  [[ -f "$path" && ! -L "$path" ]] || exit 78
  IFS= read -r value <"$path"
  [[ -n "$value" && ${#value} -le 4096 ]] || exit 78
  printf -v "$variable" '%s' "$value"
  export "$variable"
}

read_secret KC_DB_PASSWORD "${QCRM_KEYCLOAK_DB_PASSWORD_FILE:-/run/secrets/qcrm_keycloak_database_password}"
read_secret KC_BOOTSTRAP_ADMIN_PASSWORD "${QCRM_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD_FILE:-/run/secrets/qcrm_keycloak_bootstrap_admin_password}"
read_secret QCRM_ADMIN_WEB_OIDC_CLIENT_SECRET "${QCRM_ADMIN_WEB_OIDC_CLIENT_SECRET_FILE:-/run/secrets/qcrm_admin_web_oidc_client_secret}"

exec /opt/keycloak/bin/kc.sh "$@"
