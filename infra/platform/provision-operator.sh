#!/usr/bin/env bash
set -euo pipefail

[[ ${EUID} -eq 0 ]] || {
  echo "Run as root" >&2
  exit 77
}

secret_directory="${QCRM_SECRET_DIRECTORY:?set QCRM_SECRET_DIRECTORY}"
mode="${QCRM_OPERATOR_MODE:-prepare-e2e}"
username="${QCRM_OPERATOR_USERNAME:-qcrm-owner}"
email="${QCRM_OPERATOR_EMAIL:-owner@quantum.local}"
bootstrap_username="${QCRM_KEYCLOAK_BOOTSTRAP_USERNAME:-qcrm-bootstrap-admin}"
remove_bootstrap_admins="${QCRM_REMOVE_BOOTSTRAP_ADMINS:-false}"
keycloak_container="${QCRM_KEYCLOAK_CONTAINER:-quantum-platform-foundation-platform-keycloak-1}"
postgres_container="${QCRM_POSTGRES_CONTAINER:-quantum-platform-foundation-platform-postgres-1}"

[[ "$secret_directory" == /opt/quantum/secrets/* ]] || exit 78
[[ "$mode" == prepare-e2e || "$mode" == handoff ]] || exit 78
[[ "$username" =~ ^[a-z][a-z0-9-]{2,63}$ ]] || exit 78
[[ "$bootstrap_username" =~ ^[a-z][a-z0-9-]{2,63}$ ]] || exit 78
[[ "$remove_bootstrap_admins" == true || "$remove_bootstrap_admins" == false ]] || exit 78
[[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] || exit 78

bootstrap_password_file="${secret_directory}/keycloak-bootstrap-admin-password"
operator_password_file="${secret_directory}/initial-operator-password"
for path in "$bootstrap_password_file" "$operator_password_file"; do
  [[ -f "$path" && ! -L "$path" ]] || exit 78
done

temporary_directory="$(mktemp -d)"
cleanup() {
  if [[ -n "${temporary_directory:-}" && "$temporary_directory" == /tmp/tmp.* && -d "$temporary_directory" ]]; then
    rm -rf -- "$temporary_directory"
  fi
}
trap cleanup EXIT
chmod 0700 "$temporary_directory"

keycloak_ip="$(docker inspect "$keycloak_container" --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' | sed -n '/./{p;q;}')"
[[ "$keycloak_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 69
keycloak_url="http://${keycloak_ip}:8080"

tr -d '\r\n' <"$bootstrap_password_file" | curl --fail --silent --show-error \
  --output "${temporary_directory}/token.json" \
  --request POST "${keycloak_url}/realms/master/protocol/openid-connect/token" \
  --data-urlencode client_id=admin-cli \
  --data-urlencode grant_type=password \
  --data-urlencode "username=${bootstrap_username}" \
  --data-urlencode password@-

python3 - "${temporary_directory}/token.json" "${temporary_directory}/auth.conf" <<'PY'
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    token = json.load(source).get("access_token", "")
if not isinstance(token, str) or len(token) < 32:
    raise SystemExit(78)
with open(sys.argv[2], "w", encoding="utf-8") as target:
    target.write(f'header = "Authorization: Bearer {token}"\n')
os.chmod(sys.argv[2], 0o600)
PY

cat >"${temporary_directory}/user.json" <<JSON
{"username":"${username}","email":"${email}","emailVerified":true,"enabled":true}
JSON

curl --fail --silent --show-error \
  --config "${temporary_directory}/auth.conf" \
  --get "${keycloak_url}/admin/realms/quantum-platform/users" \
  --data-urlencode "username=${username}" \
  --data-urlencode exact=true \
  --output "${temporary_directory}/users.json"

user_id="$(python3 - "${temporary_directory}/users.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    users = json.load(source)
if len(users) > 1:
    raise SystemExit(78)
print(users[0]["id"] if users else "")
PY
)"

if [[ -z "$user_id" ]]; then
  curl --fail --silent --show-error \
    --config "${temporary_directory}/auth.conf" \
    --header 'Content-Type: application/json' \
    --request POST "${keycloak_url}/admin/realms/quantum-platform/users" \
    --data-binary "@${temporary_directory}/user.json"
  curl --fail --silent --show-error \
    --config "${temporary_directory}/auth.conf" \
    --get "${keycloak_url}/admin/realms/quantum-platform/users" \
    --data-urlencode "username=${username}" \
    --data-urlencode exact=true \
    --output "${temporary_directory}/users.json"
  user_id="$(python3 - "${temporary_directory}/users.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    users = json.load(source)
if len(users) != 1:
    raise SystemExit(78)
print(users[0]["id"])
PY
)"
fi

[[ "$user_id" =~ ^[0-9a-f-]{36}$ ]] || exit 78

python3 - "$operator_password_file" "${temporary_directory}/password.json" "$mode" <<'PY'
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    password = source.read().strip()
if len(password) < 14:
    raise SystemExit(78)
with open(sys.argv[2], "w", encoding="utf-8") as target:
    json.dump({"type": "password", "value": password, "temporary": sys.argv[3] == "handoff"}, target)
os.chmod(sys.argv[2], 0o600)
PY

curl --fail --silent --show-error \
  --config "${temporary_directory}/auth.conf" \
  "${keycloak_url}/admin/realms/quantum-platform/users/${user_id}/credentials" \
  --output "${temporary_directory}/credentials.json"
python3 - "${temporary_directory}/credentials.json" "${temporary_directory}/otp-ids" "${temporary_directory}/has-password" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    credentials = json.load(source)
with open(sys.argv[2], "w", encoding="utf-8") as target:
    for credential in credentials:
        if credential.get("type") == "otp":
            target.write(f'{credential["id"]}\n')
if any(credential.get("type") == "password" for credential in credentials):
    open(sys.argv[3], "w", encoding="utf-8").close()
PY
if [[ ! -e "${temporary_directory}/has-password" ]]; then
  curl --fail --silent --show-error \
    --config "${temporary_directory}/auth.conf" \
    --header 'Content-Type: application/json' \
    --request PUT "${keycloak_url}/admin/realms/quantum-platform/users/${user_id}/reset-password" \
    --data-binary "@${temporary_directory}/password.json"
fi
while IFS= read -r credential_id; do
  [[ -n "$credential_id" ]] || continue
  curl --fail --silent --show-error \
    --config "${temporary_directory}/auth.conf" \
    --request DELETE "${keycloak_url}/admin/realms/quantum-platform/users/${user_id}/credentials/${credential_id}"
done <"${temporary_directory}/otp-ids"

if [[ "$mode" == handoff ]]; then
  required_actions='["UPDATE_PASSWORD","CONFIGURE_TOTP"]'
else
  required_actions='["CONFIGURE_TOTP"]'
fi
printf '{"username":"%s","email":"%s","emailVerified":true,"enabled":true,"requiredActions":%s}\n' \
  "$username" "$email" "$required_actions" >"${temporary_directory}/user-update.json"
curl --fail --silent --show-error \
  --config "${temporary_directory}/auth.conf" \
  --header 'Content-Type: application/json' \
  --request PUT "${keycloak_url}/admin/realms/quantum-platform/users/${user_id}" \
  --data-binary "@${temporary_directory}/user-update.json"

docker exec -i --env QCRM_OPERATOR_SUBJECT="$user_id" "$postgres_container" bash <<'DB'
set -euo pipefail
export PGPASSWORD="$(cat /run/secrets/qcrm_platform_migrator_password)"
psql --set=ON_ERROR_STOP=1 --set=subject="$QCRM_OPERATOR_SUBJECT" \
  --host 127.0.0.1 --username qcrm_platform_migrator --dbname qcrm_platform <<'SQL'
BEGIN;
INSERT INTO platform_iam.operator_memberships (oidc_subject, status)
VALUES (:'subject', 'active')
ON CONFLICT (oidc_subject) DO UPDATE
SET status = 'active',
    authorization_revision = platform_iam.operator_memberships.authorization_revision +
      CASE WHEN platform_iam.operator_memberships.status = 'active' THEN 0 ELSE 1 END,
    updated_at = CASE
      WHEN platform_iam.operator_memberships.status = 'active' THEN platform_iam.operator_memberships.updated_at
      ELSE CURRENT_TIMESTAMP
    END;

INSERT INTO platform_iam.operator_permissions (operator_id, permission)
SELECT membership.id, permission::platform_iam.platform_permission
FROM platform_iam.operator_memberships AS membership
CROSS JOIN unnest(ARRAY[
  'tenants:read',
  'tenants:manage',
  'configuration:read',
  'configuration:manage',
  'deployments:read',
  'deployments:execute',
  'operators:manage'
]) AS permission
WHERE membership.oidc_subject = :'subject'
ON CONFLICT DO NOTHING;
COMMIT;
SQL
DB

if [[ "$remove_bootstrap_admins" == true ]]; then
  [[ "$bootstrap_username" == qcrm-recovery-admin ]] || exit 78
  bootstrap_admins=(qcrm-bootstrap-admin "$bootstrap_username")
  for bootstrap_admin in "${bootstrap_admins[@]}"; do
    curl --fail --silent --show-error \
      --config "${temporary_directory}/auth.conf" \
      --get "${keycloak_url}/admin/realms/master/users" \
      --data-urlencode "username=${bootstrap_admin}" \
      --data-urlencode exact=true \
      --output "${temporary_directory}/bootstrap-users.json"
    bootstrap_admin_id="$(python3 - "${temporary_directory}/bootstrap-users.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    users = json.load(source)
if len(users) > 1:
    raise SystemExit(78)
print(users[0]["id"] if users else "")
PY
)"
    if [[ -n "$bootstrap_admin_id" ]]; then
      [[ "$bootstrap_admin_id" =~ ^[0-9a-f-]{36}$ ]] || exit 78
      curl --fail --silent --show-error \
        --config "${temporary_directory}/auth.conf" \
        --request DELETE "${keycloak_url}/admin/realms/master/users/${bootstrap_admin_id}"
    fi
  done
fi

unset user_id keycloak_ip keycloak_url bootstrap_admin_id
echo "Platform operator is ready in ${mode} mode"
