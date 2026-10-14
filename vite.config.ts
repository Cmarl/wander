import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // Ships under clydemarl.me/wander, but dev stays at the root so the local
  // URL and the phone URL don't need the prefix.
  base: command === "build" ? "/wander/" : "/",
  // host:true so a phone on the LAN / tailnet can hit the dev server
  server: { host: true, port: 5173 },
  build: { target: "es2022" },
}));
