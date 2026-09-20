#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
suffix="$$"
network="qcrm-session-validation-${suffix}"
redis_container="qcrm-session-redis-${suffix}"
toolchain_image="quantum-crm/session-validation:${suffix}"
redis_image="redis@sha256:5fa2edb1e408fa8235e6db8fab01d1afaaae96c9403ba67b70feceb8661e8621"
scratch="$(mktemp -d /tmp/qcrm-session.XXXXXX)"
password="qcrm-synthetic-${suffix}-$(date +%s)"
secret_file="${scratch}/redis-url"

cleanup() {
  sudo -n docker rm -f "$redis_container" >/dev/null 2>&1 || true
  sudo -n docker network rm "$network" >/dev/null 2>&1 || true
  sudo -n docker image rm "$toolchain_image" >/dev/null 2>&1 || true
  find "$scratch" -mindepth 1 -depth -delete
  rmdir "$scratch"
}
trap cleanup EXIT

sudo -n docker network create --internal "$network" >/dev/null
printf 'redis://default:%s@%s:6379/0\n' "$password" "$redis_container" >"$secret_file"
chmod 644 "$secret_file"

sudo -n docker run --detach --name "$redis_container" \
  --network "$network" \
  --read-only \
  --tmpfs /data:rw,noexec,nosuid,size=64m \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --memory 256m \
  "$redis_image" \
  redis-server --save '' --appendonly no --requirepass "$password" >/dev/null

ready=false
for _ in $(seq 1 30); do
  if sudo -n docker exec --env "REDISCLI_AUTH=${password}" "$redis_container" \
    redis-cli ping 2>/dev/null | grep -qx PONG; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  sudo -n docker logs --tail 100 "$redis_container"
  exit 1
fi

sudo -n docker build --target toolchain --tag "$toolchain_image" \
  --file "${repository_root}/infra/docker/Dockerfile.node" "$repository_root" >/dev/null

sudo -n docker run --rm --init \
  --network "$network" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --memory 2g \
  --cpus 1 \
  --volume "${repository_root}:/workspace" \
  --volume "${secret_file}:/run/secrets/qcrm_test_session_redis_url:ro" \
  --workdir /workspace \
  --env QCRM_TEST_SESSION_REDIS_URL_FILE=/run/secrets/qcrm_test_session_redis_url \
  "$toolchain_image" \
  pnpm exec vitest run tests/integration/platform-session-redis.test.ts
