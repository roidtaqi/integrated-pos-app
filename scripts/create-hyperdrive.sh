#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

read -r -s -p "Tempel direct connection string Neon: " DIRECT_URL
printf '\n'
read -r -s -p "Masukkan password hyperdrive_user: " ROLE_PASSWORD
printf '\n'

HYPERDRIVE_URL="$({
  DIRECT_URL="$DIRECT_URL" ROLE_PASSWORD="$ROLE_PASSWORD" node --input-type=module <<'NODE'
const directUrl = process.env.DIRECT_URL || '';
const rolePassword = process.env.ROLE_PASSWORD || '';

if (!directUrl || !rolePassword) throw new Error('Connection string dan password wajib diisi.');

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
  printf 'Gagal menyiapkan koneksi Neon: %s\n' "$HYPERDRIVE_URL" >&2
  exit 1
}

unset DIRECT_URL ROLE_PASSWORD

cd "$REPO_ROOT/cloudflare-sync-server"
printf 'Membuat Hyperdrive kastur-neon dengan cache nonaktif...\n'
npx wrangler hyperdrive create kastur-neon \
  --connection-string="$HYPERDRIVE_URL" \
  --caching-disabled

unset HYPERDRIVE_URL
