#!/usr/bin/env bash
# Take pictures of the real game on the real GPU.
#   tools/shot.sh outdir "name|query" "name|query" ...
set -uo pipefail
GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
OUT="$1"; shift
mkdir -p "$OUT"
cd "$GAME_DIR"
npx vite --port 5186 --strictPort > /tmp/wander-shot-vite.log 2>&1 &
VITE=$!
python3 - "$OUT" <<'PY' &
import http.server, sys, base64, socketserver, urllib.parse, os
out = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_OPTIONS(self):
        self.send_response(200); self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Headers","*"); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get("Content-Length",0)); raw=self.rfile.read(n).decode()
        self.send_response(200); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers()
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = qs.get("name",["shot"])[0]
        png, _, errs = raw.partition("\n")
        open(os.path.join(out, name + ".png"), "wb").write(base64.b64decode(png.split(",",1)[1]))
        open(os.path.join(out, name + ".txt"), "w").write("fps " + qs.get("fps",["?"])[0] + "\n" + errs)
class S(socketserver.TCPServer): allow_reuse_address=True
S(("127.0.0.1",8917),H).serve_forever()
PY
SRV=$!
trap 'kill $VITE $SRV 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null http://localhost:5186/ && break; sleep 0.5; done
for spec in "$@"; do
  name="${spec%%|*}"; query="${spec#*|}"
  rm -f "$OUT/$name.png"
  "$BRAVE" --headless=new --no-sandbox --window-size=1280,720 --hide-scrollbars \
    --autoplay-policy=no-user-gesture-required \
    --user-data-dir="$(mktemp -d)" "http://localhost:5186/tools/game-shot.html?name=$name&$query" >/dev/null 2>&1 &
  BR=$!
  for _ in $(seq 1 45); do [ -s "$OUT/$name.png" ] && break; sleep 1; done
  sleep 0.5
  kill $BR 2>/dev/null || true
  if [ -s "$OUT/$name.png" ]; then echo "$name: $(head -1 "$OUT/$name.txt")"; else echo "$name: NO SHOT"; fi
done
