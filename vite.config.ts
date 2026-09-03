import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The shared-credit routes, locally.
 *
 * Deployed, these two paths are served by `deploy/Caddyfile.example`. Without
 * the same two here, a keyless start works in production and 404s in dev,
 * which is the worst direction for that difference to run. Three layers have
 * to agree — `server.proxy`, `preview.proxy` (a separate option, not inherited)
 * and the Caddyfile — exactly as in the model-router demo's NIM relay.
 *
 * Gemini's is a WebSocket (`ws: true`): it has no token that authenticates, so
 * the socket itself is relayed with the key attached. OpenAI's is one POST that
 * mints a short-lived client secret.
 *
 * This file runs in Node, never in the browser, so reading a key here keeps it
 * in the dev server process: it cannot reach the bundle. The `VITE_` names are
 * accepted last only because the app's own dev .env already carries them.
 */
const GEMINI_WS_PATH =
  '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

function sharedCreditProxy(mode: string) {
  const env = loadEnv(mode, '.', '');
  const geminiKey = env.VOICE_GEMINI_KEY || env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || '';
  const openaiKey = env.VOICE_OPENAI_KEY || env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || '';

  return {
    '/api/gemini-live': {
      target: 'https://generativelanguage.googleapis.com',
      changeOrigin: true,
      ws: true,
      rewrite: () => `${GEMINI_WS_PATH}?key=${encodeURIComponent(geminiKey)}`,
    },
    '/api/openai-token': {
      target: 'https://api.openai.com',
      changeOrigin: true,
      rewrite: () => '/v1/realtime/client_secrets',
      headers: openaiKey ? { Authorization: `Bearer ${openaiKey}` } : undefined,
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: { port: 3200, proxy: sharedCreditProxy(mode) },
  preview: { proxy: sharedCreditProxy(mode) },
}));
