#!/usr/bin/env bash
set -euo pipefail

secret_file="${QCRM_REDIS_PASSWORD_FILE:-/run/secrets/qcrm_redis_password}"
admin_secret_file="${QCRM_REDIS_ADMIN_PASSWORD_FILE:-/run/secrets/qcrm_redis_admin_password}"
[[ -f "$secret_file" && ! -L "$secret_file" ]] || exit 78
[[ -f "$admin_secret_file" && ! -L "$admin_secret_file" ]] || exit 78
IFS= read -r password <"$secret_file"
IFS= read -r admin_password <"$admin_secret_file"
[[ "$password" =~ ^[A-Za-z0-9_-]{43,128}$ ]] || exit 78
[[ "$admin_password" =~ ^[A-Za-z0-9_-]{43,128}$ ]] || exit 78
[[ "$password" != "$admin_password" ]] || exit 78

umask 077
printf 'user default on >%s ~qcrm:platform:* +@connection +@read +@write -@dangerous +eval +evalsha\n' \
  "$password" >/tmp/users.acl
printf 'user qcrm_admin on >%s ~* +@all\n' "$admin_password" >>/tmp/users.acl
chown redis:redis /tmp/users.acl
unset password admin_password

exec docker-entrypoint.sh redis-server \
  --aclfile /tmp/users.acl \
  --appendonly yes \
  --appendfsync everysec \
  --save '900 1 300 10 60 10000'
