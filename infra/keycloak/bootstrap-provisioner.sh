#!/usr/bin/env bash
set -euo pipefail

read_secret() {
  local variable="$1"
  local path="$2"
  local value
  [[ -f "$path" && ! -L "$path" ]] || exit 78
  IFS= read -r value <"$path"
  [[ "$value" =~ ^[A-Za-z0-9_-]{43,128}$ ]] || exit 78
  printf -v "$variable" '%s' "$value"
  export "$variable"
  unset value
}

[[ "${QCRM_KEYCLOAK_ALL_NODES_STOPPED:-}" == "confirmed" ]] || {
  echo "Set QCRM_KEYCLOAK_ALL_NODES_STOPPED=confirmed after stopping every Keycloak node" >&2
  exit 78
}

read_secret QCRM_KEYCLOAK_PROVISIONER_CLIENT_SECRET \
  "${QCRM_KEYCLOAK_PROVISIONER_CLIENT_SECRET_FILE:-/run/secrets/qcrm_keycloak_provisioner_client_secret}"

export QCRM_KEYCLOAK_PROVISIONER_CLIENT_ID="${QCRM_KEYCLOAK_PROVISIONER_CLIENT_ID:-quantum-provisioner}"
[[ "$QCRM_KEYCLOAK_PROVISIONER_CLIENT_ID" == "quantum-provisioner" ]] || exit 78

exec /opt/keycloak/bin/kc.sh bootstrap-admin service \
  --optimized \
  --no-prompt \
  --client-id:env=QCRM_KEYCLOAK_PROVISIONER_CLIENT_ID \
  --client-secret:env=QCRM_KEYCLOAK_PROVISIONER_CLIENT_SECRET
