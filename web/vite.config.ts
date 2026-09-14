import { defineConfig } from 'vite';
// host: true lets the servers answer on the LAN / Tailscale address as well as localhost.
// Note: getUserMedia only works in a secure context (https or localhost); use `tailscale serve` for https.
const hosts = ['.ts.net'];
export default defineConfig({
  build: { rollupOptions: { input: { kids: 'index.html', app: 'app.html' } } },
  server: { host: true, port: 5173, allowedHosts: hosts },
  preview: { host: true, port: 4173, allowedHosts: hosts },
});
