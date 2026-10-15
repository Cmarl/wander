import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // Ships under clydemarl.me/wander, but dev stays at the root so the local
  // URL and the phone URL don't need the prefix.
  base: command === "build" ? "/wander/" : "/",
  // host:true so a phone on the LAN / tailnet can hit the dev server
  server: { host: true, port: 5173 },
  build: { target: "es2022" },
  // Stamped into the controls sheet. When a cached browser misbehaves, the
  // first question is always "which build is that actually running".
  define: {
    __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + "Z"),
  },
}));
