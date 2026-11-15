#!/usr/bin/env bash
# semuanya: gambar (../pre, ../post), tiap scene (../video/bcio-*.mp4), rekaman CA
cd "$(dirname "$0")/.."
node _tools/posts.mjs
node _tools/render.mjs caintro _parts/caintro.mp4 && node _tools/render.mjs caoutro _parts/caoutro.mp4 && node _tools/demo.mjs
for s in lore coin board lag matrix shield basket rebalance mcp weekend burn; do node _tools/render.mjs $s; done
node _tools/render.mjs paydex ../video/bcio-dex.mp4
echo FINAL_DONE
