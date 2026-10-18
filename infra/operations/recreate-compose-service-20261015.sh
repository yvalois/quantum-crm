#!/usr/bin/env bash
set -euo pipefail

mode=${1:?mode check or apply}
container=${2:?existing container name}
extra_override=${3:-}
if [[ "$mode" != check && "$mode" != apply ]]; then
  exit 2
fi

label() {
  docker inspect "$container" --format "{{ index .Config.Labels \"com.docker.compose.$1\" }}"
}

files=$(label project.config_files)
env_file=$(label project.environment_file)
working_dir=$(label project.working_dir)
project=$(label project)
service=$(label service)
[[ -f "$env_file" && -d "$working_dir" && -n "$service" && -n "$project" ]] || exit 3

# These values are secret *file paths*, not secret values. deploy-host normally
# supplies them when it invokes Compose for a tenant.
if [[ "$working_dir" == /opt/quantum/config/staging/tenants/tenant/* ]]; then
  tenant_id=${working_dir##*/}
  secret_dir="/opt/quantum/secrets/staging/tenants/$tenant_id"
  export QCRM_YCLOUD_BINDING_SECRET_HOST_FILE="$secret_dir/ycloud-binding"
  export QCRM_YCLOUD_API_KEY_SECRET_HOST_FILE="$secret_dir/ycloud-api-key"
  export QCRM_YCLOUD_BINDING_FILE=/run/secrets/qcrm_ycloud_binding
  export QCRM_YCLOUD_API_KEY_FILE=/run/secrets/qcrm_ycloud_api_key
  export QCRM_AGENT_GATEWAY_SECRET_HOST_FILE="$secret_dir/agent-gateway-client-secret"
  export QCRM_AGENT_RUNTIME_SECRET_HOST_FILE="$secret_dir/agent-runtime-client-secret"
  export QCRM_OPENAI_API_KEY_SECRET_HOST_FILE="$secret_dir/openai-api-key"
  for path in "$QCRM_YCLOUD_BINDING_SECRET_HOST_FILE" "$QCRM_YCLOUD_API_KEY_SECRET_HOST_FILE" \
    "$QCRM_AGENT_GATEWAY_SECRET_HOST_FILE" "$QCRM_AGENT_RUNTIME_SECRET_HOST_FILE" \
    "$QCRM_OPENAI_API_KEY_SECRET_HOST_FILE"; do
    [[ -f "$path" ]] || exit 6
  done
fi

arguments=(--project-name "$project" --project-directory "$working_dir" --env-file "$env_file")
IFS=',' read -r -a config_files <<< "$files"
for path in "${config_files[@]}"; do
  [[ -f "$path" ]] || { printf 'Missing Compose file: %s\n' "$path" >&2; exit 4; }
  arguments+=(-f "$path")
done
if [[ -n "$extra_override" ]]; then
  [[ -f "$extra_override" ]] || exit 5
  arguments+=(-f "$extra_override")
fi

docker compose "${arguments[@]}" config -q
if [[ "$mode" == apply ]]; then
  docker compose "${arguments[@]}" up -d --no-deps "$service"
fi
