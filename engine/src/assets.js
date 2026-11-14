// Aset yang dipantau terminal. Saham diambil dari token resmi Robinhood (tokenized stock)
// yang diperdagangkan 24/7, jadi harganya tetap bergerak saat bursa AS tutup.
// `cg` = id CoinGecko.
export const ASSETS = [
  { symbol: 'NVDA', name: 'Nvidia', kind: 'stock', cg: 'nvidia-robinhood-tokenized-stock', note: 'Robinhood stock token' },
  { symbol: 'TSLA', name: 'Tesla', kind: 'stock', cg: 'tesla-robinhood-tokenized-stock', note: 'Robinhood stock token' },
  { symbol: 'QQQ', name: 'Invesco QQQ', kind: 'stock', cg: 'invesco-qqq-robinhood-tokenized-stock', note: 'Robinhood ETF token' },
  { symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', cg: 'bitcoin' },
  { symbol: 'ETH', name: 'Ethereum', kind: 'crypto', cg: 'ethereum' },
  { symbol: 'SOL', name: 'Solana', kind: 'crypto', cg: 'solana' },
  { symbol: 'RENDER', name: 'Render', kind: 'crypto', cg: 'render-token', note: 'AI / GPU' },
  { symbol: 'TAO', name: 'Bittensor', kind: 'crypto', cg: 'bittensor', note: 'AI' },
  { symbol: 'FET', name: 'Artificial Superintelligence Alliance', kind: 'crypto', cg: 'fetch-ai', note: 'AI' },
];

export const SYMBOLS = ASSETS.map((a) => a.symbol);
export const bySymbol = (s) => ASSETS.find((a) => a.symbol === String(s).toUpperCase());
