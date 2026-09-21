#!/usr/bin/env bash
set -euo pipefail

read_secret() {
  local path="$1"
  local value
  [[ -f "$path" && ! -L "$path" ]] || return 1
  IFS= read -r value <"$path"
  [[ "$value" =~ ^[A-Za-z0-9_-]{43,128}$ ]] || return 1
  printf '%s' "$value"
}

migrator_password="$(read_secret /run/secrets/qcrm_platform_migrator_password)"
runtime_password="$(read_secret /run/secrets/qcrm_platform_runtime_password)"
keycloak_password="$(read_secret /run/secrets/qcrm_keycloak_database_password)"
provisioner_password="$(read_secret /run/secrets/qcrm_platform_provisioner_password)"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
CREATE ROLE qcrm_platform_migrator LOGIN PASSWORD '${migrator_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE qcrm_platform_runtime LOGIN PASSWORD '${runtime_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE qcrm_keycloak LOGIN PASSWORD '${keycloak_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE qcrm_platform_provisioner LOGIN PASSWORD '${provisioner_password}' NOSUPERUSER CREATEDB CREATEROLE NOINHERIT;
CREATE DATABASE qcrm_platform OWNER qcrm_platform_migrator;
CREATE DATABASE qcrm_keycloak OWNER qcrm_keycloak;
REVOKE CONNECT ON DATABASE qcrm_platform FROM PUBLIC;
REVOKE CONNECT ON DATABASE qcrm_keycloak FROM PUBLIC;
GRANT CONNECT ON DATABASE qcrm_platform TO qcrm_platform_runtime;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname qcrm_platform <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO qcrm_platform_runtime;
SQL

unset migrator_password runtime_password keycloak_password provisioner_password
