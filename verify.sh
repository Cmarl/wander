#!/usr/bin/env bash
# Prove a deploy actually reached the edge. Usage: ./verify.sh "string one" "string two" ...
#
# Two independent failure modes have bitten us, and this guards both:
#   - the HTML can be served from edge cache still pointing at the old bundle
#   - the new asset can 404 for a few seconds, which silently returns the HTML
#     404 page; grepping that for your strings gives false negatives
# So: wait for the HTML to reference the local hash, then require the asset to
# come back as javascript of a believable size before asserting anything.
set -uo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${BASE:-https://clydemarl.me/wander}"
LOCAL=$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$GAME_DIR/dist/index.html" | head -1)
[ -n "$LOCAL" ] || { echo "no local bundle found — run npm run build first"; exit 1; }

echo "expected bundle: $LOCAL"

# 1. served HTML must reference the new hash
SERVED=""
for t in $(seq 1 10); do
  SERVED=$(curl -s -H 'Cache-Control: no-cache' -L "$BASE/?v=$RANDOM$t" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)
  [ "$SERVED" = "$LOCAL" ] && { echo "1. served HTML references $SERVED  (attempt $t)"; break; }
  echo "   edge lag: HTML still serving '${SERVED:-none}', waiting..."
  sleep 8
done
[ "$SERVED" = "$LOCAL" ] || { echo "FAIL: HTML never picked up $LOCAL"; exit 1; }

# 2. the asset itself must be real javascript, not the 404 page
OK=0
for t in $(seq 1 10); do
  TYPE=$(curl -s -o /tmp/wander-verify.js -w '%{content_type}' "$BASE/assets/$LOCAL")
  SIZE=$(wc -c < /tmp/wander-verify.js | tr -d ' ')
  case "$TYPE" in
    *javascript*) if [ "$SIZE" -gt 100000 ]; then
        echo "2. asset 200 $TYPE, $SIZE bytes  (attempt $t)"; OK=1; break
      fi;;
  esac
  echo "   asset not ready (type=${TYPE:-none} size=$SIZE), waiting..."
  sleep 8
done
[ "$OK" = 1 ] || { echo "FAIL: asset never served as javascript"; exit 1; }

# 3. routes
for path in "/" "" "/?at=100,200"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -L "$BASE$path")
  echo "3. HTTP $CODE  $BASE$path"
  [ "$CODE" = 200 ] || { echo "FAIL: $BASE$path returned $CODE"; exit 1; }
done
ROOT=$(curl -s -o /dev/null -w '%{http_code}' -L https://clydemarl.me/)
echo "3. HTTP $ROOT  https://clydemarl.me/  (site must stay up)"
[ "$ROOT" = 200 ] || { echo "FAIL: site root returned $ROOT"; exit 1; }

# 4. content assertions against the proven-real bundle
FAIL=0
for needle in "$@"; do
  if grep -q -- "$needle" /tmp/wander-verify.js; then
    echo "4. OK      \"$needle\""
  else
    echo "4. MISSING \"$needle\""; FAIL=1
  fi
done
# Regression guards: every stage so far must still be in the bundle.
for needle in "terrainHeight" "Fire Lookout" "uCrush" "wander.pins" "drag to frame" "alone here" "step out"; do
  grep -q -- "$needle" /tmp/wander-verify.js || { echo "4. REGRESSION: lost \"$needle\""; FAIL=1; }
done
[ "$FAIL" = 0 ] || { echo "FAIL: content assertions"; exit 1; }

echo "VERIFIED $LOCAL"
