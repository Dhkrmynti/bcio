#!/usr/bin/env bash
# Tes end-to-end BCIO di fork lokal Robinhood Chain MAINNET. Tidak ada transaksi ke chain asli.
#   cd engine && ./test/e2e-fork.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
UPSTREAM="${MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
PORT=8547
TMP=$(mktemp -d)

anvil --fork-url "$UPSTREAM" --port "$PORT" --silent > "$TMP/anvil.log" 2>&1 &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do cast chain-id --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break; sleep 0.5; done

# akun anvil publik: #0 deployer, #1 agent server
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
AGENT_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
OUT=$(cd ../contracts && forge script script/DeployMainnet.s.sol --rpc-url "http://127.0.0.1:$PORT" --private-key "$DEPLOYER_KEY" --broadcast 2>&1)
ADDR=$(echo "$OUT" | sed -n 's/.*OUT AGENT_CONTRACT \(0x[0-9a-fA-F]*\).*/\1/p')
[ -n "$ADDR" ] || { echo "$OUT" | tail -20; exit 1; }
printf '{"chainId":4663,"agentContract":"%s","agent":"%s"}\n' "$ADDR" "$(cast wallet address $AGENT_KEY)" > "$TMP/4663.json"

CHAIN_RPC="http://127.0.0.1:$PORT" DEPLOYMENT_FILE="$TMP/4663.json" AGENT_PRIVATE_KEY="$AGENT_KEY" node test/e2e-fork.mjs
