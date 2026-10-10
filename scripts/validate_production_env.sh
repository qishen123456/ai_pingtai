#!/usr/bin/env bash
set -Eeuo pipefail

fail() { echo "[preflight] ERROR: $*" >&2; exit 2; }
required() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
  local value_upper="${!name^^}"
  for marker in "__SET_ME__" "PLACEHOLDER" "CHANGE_ME" "EXAMPLE.INVALID" "SET_URL_SAFE_RANDOM" "SET_APPROVED_TAG" "UNCONFIGURED"; do
    [[ "$value_upper" != *"$marker"* ]] || fail "$name still contains a placeholder value"
  done
}
for name in DB_PASSWORD BACKUP_DB_PASSWORD OIDC_ISSUER_URL OIDC_CLIENT_ID OIDC_CLIENT_SECRET \
            OAUTH2_PROXY_COOKIE_SECRET OIDC_EMAIL_DOMAINS OAUTH2_PROXY_IMAGE SERVER_NAME \
            AUTH_ADMIN_GROUPS AUTH_QUALITY_GROUPS AUTH_PM_GROUPS AUTH_ENGINEERING_GROUPS AUTH_VIEWER_GROUPS \
            DCP_GATE_POLICY BOM_POLICY_VERSION IMPORT_DEDUPE_POLICY; do
  required "$name"
done

for name in DB_PASSWORD BACKUP_DB_PASSWORD; do
  value="${!name}"
  [[ "$value" =~ ^[A-Za-z0-9._-]{24,}$ ]] || fail "$name must be at least 24 chars using only A-Z, a-z, 0-9, dot, underscore or hyphen"
done
[[ "$OIDC_ISSUER_URL" == https://* ]] || fail "OIDC_ISSUER_URL must use HTTPS"
[[ "$OIDC_EMAIL_DOMAINS" != *".invalid"* ]] || fail "OIDC_EMAIL_DOMAINS still uses the reserved .invalid domain"
[[ "$SERVER_NAME" != *"://"* && "$SERVER_NAME" != */* && "$SERVER_NAME" == *.* ]] || fail "SERVER_NAME must be a hostname without scheme or path"
[[ "$OAUTH2_PROXY_IMAGE" == *:* && "$OAUTH2_PROXY_IMAGE" != *:latest ]] || fail "OAUTH2_PROXY_IMAGE must use an explicit, non-latest image tag"
[[ ${#OAUTH2_PROXY_COOKIE_SECRET} -ge 32 ]] || fail "OAUTH2_PROXY_COOKIE_SECRET must be at least 32 characters"
[[ "$DCP_GATE_POLICY" == sequential || "$DCP_GATE_POLICY" == independent ]] || fail "DCP_GATE_POLICY must be sequential or independent"
[[ "$IMPORT_DEDUPE_POLICY" == content || "$IMPORT_DEDUPE_POLICY" == row_instance ]] || fail "IMPORT_DEDUPE_POLICY must be content or row_instance"
[[ "$BOM_POLICY_VERSION" != unconfigured && "$BOM_POLICY_VERSION" != placeholder ]] || fail "BOM_POLICY_VERSION must be an approved policy identifier"

echo "[preflight] Required production settings are present and non-placeholder."
echo "[preflight] This validates configuration shape only; it does not prove IdP/API connectivity or business approval."
