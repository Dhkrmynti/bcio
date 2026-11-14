#!/usr/bin/env bash
# Deploy BCIO desk + test tokens and write engine/deployments/<chainId>.json
#
#   ./deploy.sh local     # anvil di http://127.0.0.1:8545 (jalankan `anvil` dulu)
#   ./deploy.sh testnet   # Robinhood Chain TESTNET (46630)
#
# Testnet: butuh wallet TESTING berisi sedikit ETH testnet (faucet.testnet.chain.robinhood.com).
#   DEPLOYER_PRIVATE_KEY  wallet yang membayar gas deploy
#   KEEPER_PRIVATE_KEY    wallet engine (update harga + agent). Boleh sama dengan deployer.
# Jangan pernah memakai wallet yang menyimpan dana asli.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"
NETWORK="${1:-local}"
ENGINE_ENV="../engine/.env"

if [ "$NETWORK" = "local" ]; then
  RPC_URL="http://127.0.0.1:8545"
  EXPLORER=""
  # akun bawaan anvil (publik, hanya untuk chain lokal)
  DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  KEEPER_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  EXPECT=31337
elif [ "$NETWORK" = "testnet" ]; then
  RPC_URL="${TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
  EXPLORER="https://explorer.testnet.chain.robinhood.com"
  EXPECT=46630
  # wallet testing lokal (gitignored) kalau ada
  if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ] && [ -f .testnet-wallet ]; then
    DEPLOYER_PRIVATE_KEY=$(sed -n 's/^DEPLOYER_PRIVATE_KEY=//p' .testnet-wallet)
  fi
  if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then read -r -s -p "Private key wallet TESTING untuk deploy: " DEPLOYER_PRIVATE_KEY; echo; fi
  KEEPER_PRIVATE_KEY="${KEEPER_PRIVATE_KEY:-$DEPLOYER_PRIVATE_KEY}"
else
  echo "Pakai: ./deploy.sh local|testnet"; exit 1
fi

CHAIN_ID=$(cast chain-id --rpc-url "$RPC_URL") || { echo "Tidak bisa terhubung ke $RPC_URL"; exit 1; }
[ "$CHAIN_ID" = "$EXPECT" ] || { echo "RPC ini chain $CHAIN_ID, bukan $EXPECT. Berhenti."; exit 1; }

DEPLOYER=$(cast wallet address "$DEPLOYER_PRIVATE_KEY")
KEEPER=$(cast wallet address "$KEEPER_PRIVATE_KEY")
echo "Chain    : $CHAIN_ID"
echo "Deployer : $DEPLOYER ($(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" --ether) ETH)"
echo "Keeper   : $KEEPER ($(cast balance "$KEEPER" --rpc-url "$RPC_URL" --ether) ETH)"

OUT=$(KEEPER="$KEEPER" forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast 2>&1) \
  || { echo "$OUT" | tail -20; exit 1; }

mkdir -p ../engine/deployments
echo "$OUT" | grep -E "OUT (DESK|TOKEN)" | python3 -c "
import json, sys, time
d = {'chainId': $CHAIN_ID, 'rpc': '$RPC_URL', 'explorer': '$EXPLORER', 'keeper': '$KEEPER', 'tokens': {}, 'deployedAt': int(time.time())}
for line in sys.stdin:
    p = line.split()
    if p[1] == 'DESK': d['desk'] = p[2]
    else: d['tokens'][p[2]] = p[3]
assert d.get('desk') and len(d['tokens']) == 7, d
json.dump(d, open('../engine/deployments/$CHAIN_ID.json', 'w'), indent=2)
print(json.dumps(d, indent=2))
"

# engine memakai key keeper ini untuk update harga & menjalankan aturan agent
python3 - "$ENGINE_ENV" "$NETWORK" "$KEEPER_PRIVATE_KEY" <<'PY'
import sys, os, re
path, net, key = sys.argv[1:]
lines = open(path).read().splitlines() if os.path.exists(path) else []
want = {'CHAIN': net, 'KEEPER_PRIVATE_KEY': key}
out, seen = [], set()
for l in lines:
    k = l.split('=', 1)[0]
    if k in want: out.append(f'{k}={want[k]}'); seen.add(k)
    else: out.append(l)
for k, v in want.items():
    if k not in seen: out.append(f'{k}={v}')
open(path, 'w').write('\n'.join(out) + '\n')
os.chmod(path, 0o600)
PY
echo "Selesai. engine/.env diset ke CHAIN=$NETWORK. Restart engine: cd ../engine && npm start"
