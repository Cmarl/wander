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

echo "==> staging into $SITE_DIR/public"
rm -rf "$SITE_DIR/public/wander" "$SITE_DIR/public/wander.html"
cp -r dist "$SITE_DIR/public/wander"
# The site builds with Astro's format:'file', where /about is served from
# about.html — a directory index at /wander/ alone leaves /wander a 404. Ship
# both so the bare path works too; it's under a kilobyte.
cp dist/index.html "$SITE_DIR/public/wander.html"

echo "==> deploying site"
cd "$SITE_DIR"
$NODE npm run deploy

echo "==> done: https://clydemarl.me/wander"
