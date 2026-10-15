#!/usr/bin/env bash
# Does the game actually start?
#
# A module-eval crash leaves every string in the bundle, so content assertions
# cannot see it — verify.sh reported green through six deploys of a game that
# never got past the splash. This loads the real modules in a real browser
# behind an error trap and requires the HUD to exist, which only happens if
# init ran to completion.
set -euo pipefail
GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
[ -x "$BRAVE" ] || { echo "boot: SKIP (no browser)"; exit 0; }

cd "$GAME_DIR"
npx vite --port 5179 --strictPort > /tmp/wander-boot-vite.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true; kill ${SRV:-0} 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null http://localhost:5179/ && break; sleep 0.5; done

python3 - > /tmp/wander-boot.txt 2>&1 <<'PY' &
import http.server, sys, os, threading
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_OPTIONS(self):
        self.send_response(200); self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Headers","*"); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get("Content-Length",0)); raw=self.rfile.read(n).decode()
        self.send_response(200); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers()
        sys.stdout.write(raw+"\n"); sys.stdout.flush()
        threading.Thread(target=lambda: os._exit(0)).start()
http.server.HTTPServer(("127.0.0.1",8914),H).serve_forever()
PY
SRV=$!
sleep 1

"$BRAVE" --headless --disable-gpu --no-sandbox --enable-unsafe-swiftshader \
  --user-data-dir="$(mktemp -d)" "http://localhost:5179/tools/boot-trap.html" >/dev/null 2>&1 &
BR=$!
for _ in $(seq 1 30); do [ -s /tmp/wander-boot.txt ] && break; sleep 2; done
kill $BR 2>/dev/null || true

OUT=$(cat /tmp/wander-boot.txt 2>/dev/null || true)
case "$OUT" in
  *"NO ERRORS CAUGHT"*"HUD built (past boot): true"*)
    echo "boot: OK — no errors, HUD built, splash dismissed"; exit 0 ;;
  "") echo "boot: FAIL — the page never reported back"; exit 1 ;;
  *) echo "boot: FAIL"; echo "$OUT" | head -20; exit 1 ;;
esac
