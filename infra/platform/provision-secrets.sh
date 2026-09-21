#!/usr/bin/env bash
set -euo pipefail

[[ ${EUID} -eq 0 ]] || {
  echo "Run as root" >&2
  exit 77
}

secret_directory="${QCRM_SECRET_DIRECTORY:?set QCRM_SECRET_DIRECTORY}"
app_uid="${QCRM_APP_UID:-1000}"
data_uid="${QCRM_DATA_UID:-999}"
data_gid="${QCRM_DATA_GID:-999}"

[[ "$secret_directory" == /opt/quantum/secrets/* ]] || {
  echo "QCRM_SECRET_DIRECTORY must be below /opt/quantum/secrets" >&2
  exit 78
}
[[ "$app_uid" =~ ^[0-9]+$ && "$data_uid" =~ ^[0-9]+$ && "$data_gid" =~ ^[0-9]+$ ]] || {
  echo "Container IDs must be numeric" >&2
  exit 78
}

install -d -m 0700 -o root -g root "$secret_directory"
tenant_secret_directory="${secret_directory%/platform}/tenants"
install -d -m 0700 -o "$app_uid" -g "$app_uid" "$tenant_secret_directory"

create_token() {
  local name="$1"
  local owner="$2"
  local group="$3"
  local mode="$4"
  local path="${secret_directory}/${name}"
  local temporary="${path}.tmp"
  local value

  if [[ ! -e "$path" ]]; then
    umask 077
    openssl rand -hex 32 >"$temporary"
    chown "$owner:$group" "$temporary"
    chmod "$mode" "$temporary"
    mv "$temporary" "$path"
  fi

  [[ -f "$path" && ! -L "$path" ]] || exit 78
  IFS= read -r value <"$path"
  [[ "$value" =~ ^[A-Za-z0-9_-]{43,128}$ ]] || exit 78
  chown "$owner:$group" "$path"
  chmod "$mode" "$path"
  unset value
}

create_operator_password() {
  local path="${secret_directory}/initial-operator-password"
  local temporary="${path}.tmp"
  local value

  if [[ ! -e "$path" ]]; then
    umask 077
    printf 'Qq9!%s\n' "$(openssl rand -hex 32)" >"$temporary"
    chown root:root "$temporary"
    chmod 0400 "$temporary"
    mv "$temporary" "$path"
  fi

  [[ -f "$path" && ! -L "$path" ]] || exit 78
  IFS= read -r value <"$path"
  [[ "$value" =~ ^Qq9\![A-Fa-f0-9]{64}$ ]] || exit 78
  chown root:root "$path"
  chmod 0400 "$path"
  unset value
}

create_storage_config() {
  local access_key_path="${secret_directory}/storage-s3-admin-access-key"
  local secret_key_path="${secret_directory}/storage-s3-admin-secret-key"
  local config_path="${secret_directory}/seaweedfs-s3.json"
  local access_key secret_key temporary current

  if [[ ! -e "$access_key_path" ]]; then
    umask 077
    openssl rand -hex 32 >"${access_key_path}.tmp"
    chown "$app_uid:$app_uid" "${access_key_path}.tmp"
    chmod 0400 "${access_key_path}.tmp"
    mv "${access_key_path}.tmp" "$access_key_path"
  fi
  if [[ ! -e "$secret_key_path" ]]; then
    umask 077
    openssl rand -hex 32 >"${secret_key_path}.tmp"
    chown "$app_uid:$app_uid" "${secret_key_path}.tmp"
    chmod 0400 "${secret_key_path}.tmp"
    mv "${secret_key_path}.tmp" "$secret_key_path"
  fi

  [[ -f "$access_key_path" && ! -L "$access_key_path" ]] || exit 78
  [[ -f "$secret_key_path" && ! -L "$secret_key_path" ]] || exit 78
  IFS= read -r access_key <"$access_key_path"
  IFS= read -r secret_key <"$secret_key_path"
  [[ "$access_key" =~ ^[A-Fa-f0-9]{64}$ ]] || exit 78
  [[ "$secret_key" =~ ^[A-Fa-f0-9]{64}$ ]] || exit 78

  temporary="${config_path}.tmp"
  printf '{\n  "identities": [\n    {\n      "name": "quantum-storage-admin",\n      "credentials": [{"accessKey": "%s", "secretKey": "%s"}],\n      "actions": ["Admin", "Read", "List", "Tagging", "Write"]\n    }\n  ]\n}\n' \
    "$access_key" "$secret_key" >"$temporary"
  chown "$app_uid:$app_uid" "$temporary"
  chmod 0400 "$temporary"
  if [[ -e "$config_path" ]]; then
    cmp -s "$temporary" "$config_path" || exit 78
    rm -f "$temporary"
  else
    mv "$temporary" "$config_path"
  fi
  chown "$app_uid:$app_uid" "$config_path" "$access_key_path" "$secret_key_path"
  chmod 0400 "$config_path" "$access_key_path" "$secret_key_path"
  unset access_key secret_key
}

create_derived_url() {
  local name="$1"
  local value="$2"
  local path="${secret_directory}/${name}"
  local temporary="${path}.tmp"
  local current

  if [[ ! -e "$path" ]]; then
    umask 077
    printf '%s\n' "$value" >"$temporary"
    chown "$app_uid:$app_uid" "$temporary"
    chmod 0400 "$temporary"
    mv "$temporary" "$path"
  fi

  [[ -f "$path" && ! -L "$path" ]] || exit 78
  IFS= read -r current <"$path"
  [[ "$current" == "$value" ]] || exit 78
  chown "$app_uid:$app_uid" "$path"
  chmod 0400 "$path"
  unset current
}

create_token postgres-admin-password "$data_uid" "$data_gid" 0400
create_token platform-migrator-password "$data_uid" "$data_gid" 0400
create_token platform-runtime-password "$data_uid" "$data_gid" 0400
create_token platform-provisioner-password "$app_uid" "$app_uid" 0400
create_token keycloak-database-password "$app_uid" "$data_gid" 0440
create_token keycloak-bootstrap-admin-password "$app_uid" "$app_uid" 0400
create_token platform-redis-password "$app_uid" "$data_gid" 0440
create_token admin-web-oidc-client-secret "$app_uid" "$app_uid" 0400
create_operator_password
create_storage_config

migrator_password="$(<"${secret_directory}/platform-migrator-password")"
runtime_password="$(<"${secret_directory}/platform-runtime-password")"
redis_password="$(<"${secret_directory}/platform-redis-password")"
provisioner_password="$(<"${secret_directory}/platform-provisioner-password")"

create_derived_url platform-migration-database-url \
  "postgresql://qcrm_platform_migrator:${migrator_password}@platform-postgres:5432/qcrm_platform?sslmode=disable"
create_derived_url platform-database-url \
  "postgresql://qcrm_platform_runtime:${runtime_password}@platform-postgres:5432/qcrm_platform?sslmode=disable"
create_derived_url platform-provisioner-database-url \
  "postgresql://qcrm_platform_provisioner:${provisioner_password}@platform-postgres:5432/postgres?sslmode=disable"
create_derived_url admin-web-session-redis-url \
  "redis://default:${redis_password}@platform-redis:6379/0"

unset migrator_password runtime_password provisioner_password redis_password
echo "Platform secret files are ready"
