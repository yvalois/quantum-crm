#!/usr/bin/env bash
set -euo pipefail

# One-time staging cutover. Never prints the configuration files: they may
# contain secrets. The immutable .bak files allow a coordinated rollback.
old_origin=https://identity.2-25-172-119.nip.io
new_origin=https://identity.quantumbusinessassistant.com
config_root=/opt/quantum/config/staging
backup_suffix=.bak-identity-20261015

files=(
  "$config_root/foundation.env"
  "$config_root/platform.env"
)
while IFS= read -r -d '' path; do
  if grep -qF "$old_origin" "$path"; then
    files+=("$path")
  fi
done < <(find "$config_root/tenants/tenant" -type f \( -name runtime.env -o -name configuration.json \) -print0)

for path in "${files[@]}"; do
  if [[ ! -f "$path" ]]; then
    printf 'Missing configuration: %s\n' "$path" >&2
    exit 1
  fi
  if [[ -e "$path$backup_suffix" ]]; then
    continue
  fi
  cp -a -- "$path" "$path$backup_suffix"
done

for path in "${files[@]}"; do
  if grep -qF "$old_origin" "$path"; then
    sed -i "s#${old_origin}#${new_origin}#g" "$path"
    chown --reference="$path$backup_suffix" "$path"
    chmod --reference="$path$backup_suffix" "$path"
  fi
done

printf 'Updated identity origin in %s configuration files; backups retained.\n' "${#files[@]}"
