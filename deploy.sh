#!/usr/bin/env bash
# Build Wander and publish it to clydemarl.me/wander.
#
# The game is a static bundle, so it rides along inside the Astro site's
# public/ directory and goes out with the site's normal wrangler deploy.
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="${SITE_DIR:-$HOME/Code/clydemarl-me}"
NODE="/opt/homebrew/bin/mise exec node@22 --"

[ -d "$SITE_DIR" ] || { echo "site repo not found at $SITE_DIR" >&2; exit 1; }

echo "==> building game"
cd "$GAME_DIR"
npm run build

# Never ship a game that does not start. This is the check that was missing
# when six deploys went out on a boot crash.
echo "==> checking it boots"
"$GAME_DIR/bootcheck.sh"
# And the shaders, which bootcheck cannot see: a GLSL error is logged to the
# console and swallowed, so the HUD builds fine over a black world.
"$GAME_DIR/shadercheck.sh"

echo "==> staging into $SITE_DIR/public"
rm -rf "$SITE_DIR/public/wander" "$SITE_DIR/public/wander.html"
cp -r dist "$SITE_DIR/public/wander"
# The site builds with Astro's format:'file', where /about is served from
# about.html — a directory index at /wander/ alone leaves /wander a 404. Ship
# both so the bare path works too; it's under a kilobyte.
cp dist/index.html "$SITE_DIR/public/wander.html"

# The HTML names the hashed bundle, so a browser holding BOTH in cache runs an
# entire stale copy of the game with no way to notice. Assets stay immutable —
# their names change — but the entry point must always be refetched. Scoped to
# /wander so nothing else on the site is affected.
cat > "$SITE_DIR/public/_headers" <<'HEADERS'
/wander
  Cache-Control: no-store, must-revalidate
/wander/
  Cache-Control: no-store, must-revalidate
/wander.html
  Cache-Control: no-store, must-revalidate
HEADERS

echo "==> deploying site"
cd "$SITE_DIR"
$NODE npm run deploy

echo "==> done: https://clydemarl.me/wander"
