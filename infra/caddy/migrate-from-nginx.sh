#!/usr/bin/env bash
set -euo pipefail

[[ ${EUID} -eq 0 ]] || {
  echo "Run as root" >&2
  exit 77
}

repository_directory="${QCRM_REPOSITORY_DIRECTORY:?set QCRM_REPOSITORY_DIRECTORY}"
environment_file="${QCRM_EDGE_ENV_FILE:?set QCRM_EDGE_ENV_FILE}"
compose_file="${repository_directory}/infra/compose/edge.yaml"

revision="${repository_directory##*/}"
[[ "$repository_directory" == /opt/quantum/builds/* && "$revision" =~ ^[0-9a-f]{40}$ && -f "$repository_directory/package.json" ]] || exit 78
[[ "$environment_file" == /opt/quantum/config/* && -f "$environment_file" && ! -L "$environment_file" ]] || exit 78
[[ -f "$compose_file" && -f "${repository_directory}/infra/caddy/Caddyfile" ]] || exit 78

set -a
# shellcheck disable=SC1090
source "$environment_file"
set +a

hosts=(
  "${QCRM_QUANTUM_SITE_HOST:?set QCRM_QUANTUM_SITE_HOST}"
  "${QCRM_MR_BUSINESS_SITE_HOST:?set QCRM_MR_BUSINESS_SITE_HOST}"
  "${QCRM_ADMIN_HOST:?set QCRM_ADMIN_HOST}"
  "${QCRM_IDENTITY_HOST:?set QCRM_IDENTITY_HOST}"
)

for host in "${hosts[@]}"; do
  mapfile -t addresses < <(getent ahostsv4 "$host" | awk '{print $1}' | sort -u)
  [[ ${#addresses[@]} -eq 1 && "${addresses[0]}" == "${QCRM_PUBLIC_IPV4:?set QCRM_PUBLIC_IPV4}" ]] || {
    echo "DNS preflight failed for ${host}" >&2
    exit 69
  }
done

nginx -t
systemctl is-active --quiet nginx
systemctl is-active --quiet certbot.timer

docker compose --env-file "$environment_file" -f "$compose_file" config --quiet
docker compose --env-file "$environment_file" -f "$compose_file" run --rm --no-deps --pull never edge-proxy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

rollback() {
  docker compose --env-file "$environment_file" -f "$compose_file" down --remove-orphans >/dev/null 2>&1 || true
  systemctl enable --now nginx certbot.timer >/dev/null 2>&1 || true
}
trap rollback ERR

systemctl disable --now certbot.timer nginx
docker compose --env-file "$environment_file" -f "$compose_file" up -d --pull never --wait

for attempt in $(seq 1 24); do
  all_ready=true
  for host in "${hosts[@]}"; do
    if ! curl --fail --silent --show-error --location --max-time 10 "https://${host}/" >/dev/null; then
      all_ready=false
      break
    fi
  done
  "$all_ready" && break
  [[ "$attempt" -lt 24 ]] || exit 69
  sleep 5
done

trap - ERR
echo "Caddy is active; Nginx and Certbot timer are disabled but preserved"
