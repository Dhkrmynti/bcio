#!/usr/bin/env bash
# Deploy BcioAgent ke Robinhood Chain MAINNET (4663). DIJALANKAN SENDIRI OLEH PEMILIK.
#
#   cd contracts && ./deploy.sh
#
# Yang terjadi:
#  1. Cek RPC benar-benar chain 4663 dan semua token/feed/router yang dipakai ada di chain.
#  2. Minta private key wallet DEPLOYER (diketik tersembunyi, tidak disimpan). Wallet ini membayar
#     gas deploy dengan ETH asli di Robinhood Chain dan menjadi owner kontrak (hanya bisa
#     mengatur daftar token, tidak bisa menyentuh dana user).
#  3. Membuat key AGENT baru khusus server (kalau belum ada di engine/.env.mainnet). Key ini yang
#     menjalankan trade otomatis, hanya dalam batas yang ditandatangani tiap user. Isi alamatnya
#     dengan sedikit ETH untuk gas (mis. 0.005 ETH).
#  4. Menulis engine/deployments/4663.json.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"
RPC_URL="${MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
ENV_OUT="../engine/.env.mainnet"

CHAIN_ID=$(cast chain-id --rpc-url "$RPC_URL") || { echo "Tidak bisa terhubung ke $RPC_URL"; exit 1; }
[ "$CHAIN_ID" = "4663" ] || { echo "RPC ini chain $CHAIN_ID, bukan 4663. Berhenti."; exit 1; }

echo "Memeriksa kontrak yang dipakai di chain…"
check() { # alamat, fungsi, harapan
  local got; got=$(cast call "$1" "$2" --rpc-url "$RPC_URL" 2>/dev/null | cast --to-ascii 2>/dev/null | tr -d '\0' | xargs || true)
  [[ "$got" == *"$3"* ]] || { echo "  GAGAL: $1 $2 = '$got' (harusnya mengandung '$3')"; exit 1; }
  echo "  ok  $3"
}
check 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 "symbol()" USDG
check 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 "symbol()" WETH
check 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC "symbol()" NVDA
check 0x322F0929c4625eD5bAd873c95208D54E1c003b2d "symbol()" TSLA
check 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 "symbol()" QQQ
check 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 "description()" "USDG / USD"
check 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9 "description()" "ETH / USD"
check 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 "description()" "NVDA / USD"
check 0x4A1166a659A55625345e9515b32adECea5547C38 "description()" "TSLA / USD"
check 0x80901d846d5D7B030F26B480776EE3b29374C2ae "description()" "QQQ / USD"
[ "$(cast code 0xCaf681a66D020601342297493863E78C959E5cb2 --rpc-url "$RPC_URL" | wc -c)" -gt 100 ] || { echo "SwapRouter02 tidak ada"; exit 1; }
echo "  ok  SwapRouter02"

echo
echo "Uji kontrak di salinan (fork) mainnet dulu, tanpa transaksi sungguhan…"
forge test --match-contract BcioAgentFork --fork-url "$RPC_URL" -q || { echo "Tes gagal. Berhenti."; exit 1; }
echo "  ok  semua tes lulus"

# key agent server (baru, khusus BCIO)
if [ -f "$ENV_OUT" ] && grep -q '^AGENT_PRIVATE_KEY=' "$ENV_OUT"; then
  AGENT_KEY=$(sed -n 's/^AGENT_PRIVATE_KEY=//p' "$ENV_OUT")
else
  AGENT_KEY=$(cast wallet new --json | python3 -c "import json,sys; d=json.load(sys.stdin); d=d.get('data', d) if isinstance(d, dict) else d; print(d[0]['private_key'])")
  ( umask 077; printf 'AGENT_PRIVATE_KEY=%s\n' "$AGENT_KEY" > "$ENV_OUT" )
fi
AGENT=$(cast wallet address "$AGENT_KEY")

echo
read -r -s -p "Private key wallet DEPLOYER (berisi sedikit ETH di Robinhood Chain): " DEPLOYER_KEY; echo
DEPLOYER=$(cast wallet address "$DEPLOYER_KEY")
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" --ether)
echo "Deployer : $DEPLOYER ($BAL ETH)"
echo "Agent    : $AGENT ($(cast balance "$AGENT" --rpc-url "$RPC_URL" --ether) ETH)"
read -r -p "Deploy BcioAgent ke MAINNET sekarang? ketik 'deploy' untuk lanjut: " OK
[ "$OK" = "deploy" ] || { echo "Dibatalkan."; exit 1; }

OUT=$(forge script script/DeployMainnet.s.sol --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --broadcast --slow 2>&1) \
  || { echo "$OUT" | tail -20; exit 1; }
unset DEPLOYER_KEY
ADDR=$(echo "$OUT" | sed -n 's/.*OUT AGENT_CONTRACT \(0x[0-9a-fA-F]*\).*/\1/p')
[ -n "$ADDR" ] || { echo "$OUT" | tail -20; exit 1; }

mkdir -p ../engine/deployments
python3 - "$ADDR" "$AGENT" "$DEPLOYER" "$RPC_URL" <<'PY'
import json, sys, time
addr, agent, owner, rpc = sys.argv[1:]
d = {
  "chainId": 4663, "name": "Robinhood Chain", "rpc": rpc, "explorer": "https://robinhoodchain.blockscout.com",
  "agentContract": addr, "agent": agent, "owner": owner, "deployedAt": int(time.time()),
  "router": "0xCaf681a66D020601342297493863E78C959E5cb2", "quoter": "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  "usd": "USDG",
  "tokens": {
    "USDG": {"address": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "decimals": 6, "feed": "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2"},
    "ETH":  {"address": "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", "decimals": 18, "feed": "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9", "fee": 100, "token": "WETH"},
    "NVDA": {"address": "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", "decimals": 18, "feed": "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", "fee": 500},
    "TSLA": {"address": "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", "decimals": 18, "feed": "0x4A1166a659A55625345e9515b32adECea5547C38", "fee": 3000},
    "QQQ":  {"address": "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", "decimals": 18, "feed": "0x80901d846d5D7B030F26B480776EE3b29374C2ae", "fee": 500}
  }
}
json.dump(d, open("../engine/deployments/4663.json", "w"), indent=2)
print(json.dumps({k: d[k] for k in ("agentContract", "agent", "owner")}, indent=2))
PY
echo
echo "Selesai. Kontrak: https://robinhoodchain.blockscout.com/address/$ADDR"
echo "Langkah berikutnya:"
echo "  1. Kirim ~0.005 ETH (Robinhood Chain) ke alamat agent $AGENT untuk gas trade otomatis."
echo "  2. Dari folder bcio/: ./deploy/deploy.sh  (mengirim deployment + key agent ke server, automation menyala)."
