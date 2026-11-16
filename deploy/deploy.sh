#!/usr/bin/env bash
# Deploy BCIO (engine + web) ke VPS: rsync, npm install, pm2, nginx + Let's Encrypt.
# Pemakaian (dari folder bcio/):  ./deploy/deploy.sh            (DOMAIN default bcio.trade)
# engine/.env dan engine/data/ hanya ada di VPS dan tidak pernah ditimpa. Kalau .env belum ada di VPS,
# file engine/.env lokal dikirim sekali (berisi key Claude).
set -euo pipefail
HOST=${HOST:-root@203.194.113.116}
DOMAIN=${DOMAIN:-bcio.trade}
APP=/var/www/$DOMAIN/app
SSH="ssh -o BatchMode=yes"
cd "$(dirname "$0")/.."

$SSH "$HOST" "mkdir -p $APP/engine/data /var/www/$DOMAIN"
rsync -az --delete -e "$SSH" --exclude '.DS_Store' web/ "$HOST:$APP/web/"
rsync -az --delete -e "$SSH" --filter="protect /node_modules/" --filter="protect /data/" --filter="protect /.env" \
  --exclude node_modules --exclude /.env --exclude '/data/*' --exclude /test/ --exclude '.DS_Store' \
  engine/ "$HOST:$APP/engine/"
rsync -az -e "$SSH" deploy/ "$HOST:$APP/deploy/"

if ! $SSH "$HOST" "test -f $APP/engine/.env"; then
  test -f engine/.env || { echo "engine/.env lokal tidak ada"; exit 1; }
  $SSH "$HOST" "umask 077; cat > $APP/engine/.env" < engine/.env
  echo ".env dikirim ke VPS (chmod 600)"
fi

# Mainnet: key agent (dibuat contracts/deploy.sh) masuk ke .env di VPS; variabel testnet lama dibuang.
# Key dikirim lewat stdin, tidak pernah muncul di layar atau argumen perintah.
AGENT_LINE=$(grep -s '^AGENT_PRIVATE_KEY=' engine/.env.mainnet || true)
printf '%s\n' "$AGENT_LINE" | $SSH "$HOST" "python3 -c '
import os, sys
p = \"$APP/engine/.env\"
new = sys.stdin.read().strip()
keep = [l for l in open(p).read().splitlines() if not l.startswith((\"CHAIN=\", \"KEEPER_PRIVATE_KEY=\")) and not (new and l.startswith(\"AGENT_PRIVATE_KEY=\"))]
if new: keep.append(new)
open(p, \"w\").write(\"\\n\".join(keep) + \"\\n\"); os.chmod(p, 0o600)
'"
[ -n "$AGENT_LINE" ] && echo "key agent mainnet terpasang di VPS" || echo "belum ada key agent (jalankan contracts/deploy.sh): basket jalan, automation menunggu"

$SSH "$HOST" "export LC_ALL=C.UTF-8; set -e
  cd $APP/engine && npm install --omit=dev --no-audit --no-fund >/dev/null
  pm2 startOrRestart $APP/deploy/ecosystem.config.cjs --update-env >/dev/null && pm2 save >/dev/null
  for i in \$(seq 1 30); do sleep 1; curl -fsS -o /dev/null http://127.0.0.1:5860/ 2>/dev/null && echo 'app up on :5860' && break; done
  CONF=/etc/nginx/conf.d/$DOMAIN.conf
  if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
    # tahap 1: HTTP saja untuk tantangan ACME, lalu ambil sertifikat
    printf 'server {\n  listen 80;\n  listen [::]:80;\n  server_name $DOMAIN www.$DOMAIN;\n  location /.well-known/acme-challenge/ { root /var/www/$DOMAIN; }\n  location / { return 404; }\n}\n' > \$CONF
    nginx -t -q && systemctl reload nginx
    certbot certonly --webroot -w /var/www/$DOMAIN -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring -q \
      --deploy-hook 'systemctl reload nginx'
  fi
  sed 's/__DOMAIN__/$DOMAIN/g' $APP/deploy/nginx.conf.tpl > \$CONF
  nginx -t -q && systemctl reload nginx && echo 'nginx ok'"
echo "deployed → https://$DOMAIN"
