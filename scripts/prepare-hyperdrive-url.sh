#!/usr/bin/env bash

set -euo pipefail

read -r -s -p "Tempel direct connection string Neon: " DIRECT_URL
printf '\n'
read -r -s -p "Masukkan password hyperdrive_user: " ROLE_PASSWORD
printf '\n'

HYPERDRIVE_URL="$({
  DIRECT_URL="$DIRECT_URL" ROLE_PASSWORD="$ROLE_PASSWORD" node --input-type=module <<'NODE'
const directUrl = process.env.DIRECT_URL || '';
const rolePassword = process.env.ROLE_PASSWORD || '';

if (!directUrl || !rolePassword) {
  throw new Error('Connection string dan password wajib diisi.');
}

const url = new URL(directUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  throw new Error('Connection string harus menggunakan protocol postgresql://.');
}
if (url.hostname.includes('-pooler')) {
  throw new Error('Gunakan direct connection string dengan Connection pooling OFF.');
}

url.username = 'hyperdrive_user';
url.password = rolePassword;
console.log(url.toString());
NODE
} 2>&1)" || {
  printf 'Gagal: %s\n' "$HYPERDRIVE_URL" >&2
  exit 1
}

unset DIRECT_URL ROLE_PASSWORD

printf '\nConnection string untuk Cloudflare Hyperdrive:\n%s\n' "$HYPERDRIVE_URL"
printf '\nJangan kirim hasil ini ke chat atau menyimpannya di Git.\n'
