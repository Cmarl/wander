#!/usr/bin/env bash
# Do the shaders compile, and does anything come out of them?
#
# bootcheck.sh catches a module that throws. It CANNOT catch a GLSL error:
# three logs the compile log to the console and carries on, init finishes, the
# HUD builds, and the game ships with a black world. Every graphics change
# needs its own gate, and this is it.
set -euo pipefail
GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
[ -x "$BRAVE" ] || { echo "shaders: SKIP (no browser)"; exit 0; }

cd "$GAME_DIR"
npx vite --port 5184 --strictPort > /tmp/wander-shader-vite.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true; kill ${SRV:-0} 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null http://localhost:5184/ && break; sleep 0.5; done

rm -f /tmp/wander-shader.txt
python3 - > /tmp/wander-shader.txt 2>&1 <<'PY' &
import http.server, sys, threading, socketserver, time
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_OPTIONS(self):
        self.send_response(200); self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Headers","*"); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get("Content-Length",0)); raw=self.rfile.read(n)
        self.send_response(200); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers()
        # 8916 is the landscape PNG, which this gate does not need — only the
        # text report decides pass or fail.
        if self.server.server_address[1] == 8915:
            sys.stdout.write(raw.decode()+"\n"); sys.stdout.flush()
class S(socketserver.TCPServer): allow_reuse_address=True
for port in (8915, 8916):
    srv=S(("127.0.0.1",port),H); threading.Thread(target=srv.serve_forever,daemon=True).start()
time.sleep(300)
PY
SRV=$!
sleep 1

"$BRAVE" --headless --disable-gpu --no-sandbox --enable-unsafe-swiftshader \
  --user-data-dir="$(mktemp -d)" "http://localhost:5184/tools/shader-check.html" >/dev/null 2>&1 &
BR=$!
for _ in $(seq 1 90); do grep -q "assertions" /tmp/wander-shader.txt 2>/dev/null && break; sleep 2; done
kill $BR 2>/dev/null || true

OUT=$(cat /tmp/wander-shader.txt 2>/dev/null || true)
case "$OUT" in
  *"all assertions passed"*) echo "shaders: OK — all compile, all draw, cloud shadows live"; exit 0 ;;
  "") echo "shaders: FAIL — the page never reported back"; exit 1 ;;
  *) echo "shaders: FAIL"; echo "$OUT" | grep -E "FAIL|GL:" | head -12; exit 1 ;;
esac
