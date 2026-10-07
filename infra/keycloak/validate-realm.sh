#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
container="qcrm-keycloak-validation-$$"
image="quay.io/keycloak/keycloak@sha256:82a77884f3af238beab1e7afd63b5f530e1b5c0590bd7aa60b40a40463e29b2c"
realm_file="${repository_root}/infra/keycloak/quantum-platform-realm.json"
scratch="$(mktemp -d /tmp/qcrm-keycloak.XXXXXX)"
bootstrap_password="qcrm-validation-$(date +%s)-$$"

cleanup() {
  sudo -n docker rm -f "$container" >/dev/null 2>&1 || true
  find "$scratch" -mindepth 1 -depth -delete
  rmdir "$scratch"
}
trap cleanup EXIT

sudo -n docker run --detach --name "$container" \
  --publish 127.0.0.1::8080 \
  --env KC_BOOTSTRAP_ADMIN_USERNAME=validation-admin \
  --env "KC_BOOTSTRAP_ADMIN_PASSWORD=${bootstrap_password}" \
  --env QCRM_ADMIN_WEB_ORIGIN=http://admin-web.example.test \
  --mount "type=bind,src=${realm_file},dst=/opt/keycloak/data/import/quantum-platform-realm.json,readonly" \
  "$image" start-dev --import-realm >/dev/null

port="$(sudo -n docker port "$container" 8080/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
base="http://127.0.0.1:${port}"

ready=false
for _ in $(seq 1 90); do
  if curl --fail --silent --show-error \
    "$base/realms/quantum-platform/.well-known/openid-configuration" \
    --output "$scratch/discovery.json" 2>/dev/null; then
    ready=true
    break
  fi
  sleep 2
done

if [[ "$ready" != true ]]; then
  sudo -n docker logs --tail 120 "$container"
  exit 1
fi

curl --fail --silent --show-error \
  "$base/realms/quantum-platform/protocol/openid-connect/certs" \
  --output "$scratch/jwks.json"

token="$(curl --fail --silent --show-error \
  --data-urlencode client_id=admin-cli \
  --data-urlencode username=validation-admin \
  --data-urlencode "password=${bootstrap_password}" \
  --data-urlencode grant_type=password \
  "$base/realms/master/protocol/openid-connect/token" | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"

admin_get() {
  curl --fail --silent --show-error \
    --header "Authorization: Bearer ${token}" \
    "$base$1" --output "$2"
}

admin_get /admin/realms/quantum-platform "$scratch/realm.json"
admin_get '/admin/realms/quantum-platform/clients?clientId=quantum-admin-web' "$scratch/clients.json"
admin_get /admin/realms/quantum-platform/users?max=1 "$scratch/users.json"
admin_get /admin/realms/quantum-platform/authentication/flows "$scratch/flows.json"

client_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0]["id"])' "$scratch/clients.json")"
admin_get "/admin/realms/quantum-platform/clients/${client_id}/protocol-mappers/models" "$scratch/mappers.json"
admin_get '/admin/realms/quantum-platform/authentication/flows/quantum-platform-loa-1/executions' "$scratch/loa1.json"
admin_get '/admin/realms/quantum-platform/authentication/flows/quantum-platform-loa-2/executions' "$scratch/loa2.json"

python3 - "$scratch" "$base" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
base = sys.argv[2]
load = lambda name: json.loads((root / name).read_text())

discovery = load("discovery.json")
assert discovery["issuer"] == f"{base}/realms/quantum-platform"
jwks = load("jwks.json")
assert any(key.get("kty") == "RSA" and key.get("use") == "sig" for key in jwks["keys"])

realm = load("realm.json")
assert realm["realm"] == "quantum-platform"
assert realm["enabled"] is True
assert realm["internationalizationEnabled"] is True
assert realm["supportedLocales"] == ["es"]
assert realm["defaultLocale"] == "es"
assert realm["browserFlow"] == "quantum-platform-browser"
assert realm["bruteForceProtected"] is True
assert realm["otpPolicyType"] == "totp"
assert realm["accessTokenLifespan"] == 300

clients = load("clients.json")
assert len(clients) == 1
client = clients[0]
assert client["publicClient"] is False
assert client["standardFlowEnabled"] is True
assert client["implicitFlowEnabled"] is False
assert client["directAccessGrantsEnabled"] is False
assert client["serviceAccountsEnabled"] is False
assert client["redirectUris"] == ["http://admin-web.example.test/api/auth/callback/keycloak"]
assert client["webOrigins"] == ["http://admin-web.example.test"]
assert client["attributes"]["pkce.code.challenge.method"] == "S256"
assert client["attributes"]["minimum.acr.value"] == "2"

assert load("users.json") == []
mapper_configurations = [mapper["config"] for mapper in load("mappers.json")]
assert any(config.get("included.custom.audience") == "quantum-admin-api" for config in mapper_configurations)
assert any(
    config.get("claim.name") == "qcrm_principal_type" and config.get("claim.value") == "human"
    for config in mapper_configurations
)

flow_aliases = {flow["alias"] for flow in load("flows.json")}
assert "quantum-platform-browser" in flow_aliases
assert any(
    execution.get("providerId") == "auth-username-password-form"
    and execution.get("requirement") == "REQUIRED"
    for execution in load("loa1.json")
)
assert any(
    execution.get("providerId") == "auth-otp-form" and execution.get("requirement") == "REQUIRED"
    for execution in load("loa2.json")
)
PY

printf '%s\n' 'Keycloak 26.7.4 realm import and Admin API validation passed'
