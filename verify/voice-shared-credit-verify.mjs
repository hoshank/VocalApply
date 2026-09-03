/**
 * The shared-credit routes, both of them, against a running server.
 *
 * The two providers reach shared credit by different means and the difference
 * is not cosmetic:
 *
 *   OpenAI  POST /api/openai-token -> a short-lived client secret. The browser
 *           then talks to api.openai.com directly, so no audio crosses the box.
 *   Gemini  wss /api/gemini-live   -> the socket itself, relayed, because
 *           Gemini has no token that authenticates on the Live socket. Every
 *           audio frame crosses the box for the whole session.
 *
 * What this asserts is the part that is cheap to get wrong: that a page with an
 * EMPTY key field opens a working Live session, that the credential never
 * appears in the bundle or on the wire to the browser, and that the relay
 * really is reaching Google rather than answering locally.
 *
 *   cd hackathon/agentic-voice-application && npm run build
 *   npx vite preview --port 3250 --strictPort --host 127.0.0.1
 *   cd tools/screenshots && node voice-shared-credit-verify.mjs
 *
 * Against the deployment instead:
 *   URL=https://vocalapply.trustvalidated.com node voice-shared-credit-verify.mjs
 *
 * Needs no key of its own — that is the whole point of the routes it checks.
 * It does spend a few seconds of the deployment's Gemini credit.
 */

import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://127.0.0.1:3250';
const MODEL = process.env.MODEL || 'gemini-3.1-flash-live-preview';

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle0' });

// 1. The Gemini relay carries a real Live session with no key in the page.
const gemini = await page.evaluate(
  (model) =>
    new Promise((resolve) => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/api/gemini-live`);
      let opened = false;
      const done = (verdict) => {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        resolve(verdict);
      };
      const timer = setTimeout(() => done(opened ? 'upgraded, then silent' : 'never upgraded'), 20000);
      ws.onopen = () => {
        opened = true;
        ws.send(
          JSON.stringify({
            setup: { model: `models/${model}`, generationConfig: { responseModalities: ['AUDIO'] } },
          })
        );
      };
      ws.onmessage = async (event) => {
        const raw =
          typeof event.data === 'string' ? event.data : await new Response(event.data).text();
        clearTimeout(timer);
        done(raw.includes('setupComplete') ? 'setupComplete' : `replied: ${raw.slice(0, 140)}`);
      };
      ws.onclose = (event) => {
        clearTimeout(timer);
        done(`closed ${event.code} ${event.reason || '(no reason)'}`);
      };
      ws.onerror = () => {};
    }),
  MODEL
);
check(gemini === 'setupComplete', `the Gemini relay reaches a live session with no key: ${gemini}`);

// 2. The OpenAI mint route returns a client secret, and it is short-lived.
const openai = await page.evaluate(async () => {
  try {
    const r = await fetch('/api/openai-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: { type: 'realtime', model: 'gpt-realtime' } }),
    });
    const text = await r.text();
    // Parse before truncating: the secret sits ahead of a long session object.
    let value = '';
    let expiresAt = 0;
    try {
      const json = JSON.parse(text);
      value = typeof json.value === 'string' ? json.value : '';
      expiresAt = typeof json.expires_at === 'number' ? json.expires_at : 0;
    } catch {
      /* reported through `text` */
    }
    return { status: r.status, value, expiresAt, text: text.slice(0, 200) };
  } catch (error) {
    return { status: 0, value: '', expiresAt: 0, text: String(error) };
  }
});
check(
  openai.status === 200 && openai.value.startsWith('ek_'),
  `the OpenAI relay mints an ephemeral secret (${openai.status}): ${openai.value ? `${openai.value.slice(0, 3)}…` : openai.text}`
);
const livesFor = openai.expiresAt ? openai.expiresAt - Math.floor(Date.now() / 1000) : 0;
check(
  livesFor > 0 && livesFor < 3600,
  `that secret is short-lived, not a key: expires in ${livesFor}s`
);

// 3. Neither long-lived key is anywhere the browser can read it.
const bundleLeak = await page.evaluate(async () => {
  const html = await (await fetch(location.pathname)).text();
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  let joined = html;
  for (const src of scripts) joined += await (await fetch(src)).text();
  return {
    aiza: /AIza[0-9A-Za-z_-]{20,}/.test(joined),
    authKey: /\bAQ\.[0-9A-Za-z_-]{20,}/.test(joined),
    openai: /\bsk-[A-Za-z0-9_-]{20,}/.test(joined),
  };
});
check(!bundleLeak.aiza, 'no AIza-shaped key in the served bundle');
check(!bundleLeak.authKey, 'no AQ.-shaped Gemini auth key in the served bundle');
check(!bundleLeak.openai, 'no sk- OpenAI key in the served bundle');
check(!errors.length, `no page error: ${errors.join(' | ') || 'none'}`);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall checks passed');
