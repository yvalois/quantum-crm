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

set -a
# shellcheck disable=SC1090
source "$environment_file"
set +a

nginx -t
docker compose --env-file "$environment_file" -f "$compose_file" down --remove-orphans
systemctl enable --now nginx certbot.timer
systemctl is-active --quiet nginx
curl --fail --silent --show-error --location --max-time 10 \
  "https://${QCRM_QUANTUM_SITE_HOST:?set QCRM_QUANTUM_SITE_HOST}/" >/dev/null
echo "Nginx and Certbot timer are active; Caddy is stopped"
