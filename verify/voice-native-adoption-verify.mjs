/**
 * The page must never take `document.modelContext` away from the browser.
 *
 * This is the check for a bug that made the demo look completely broken to an
 * external agent while every in-page test passed. The polyfill's "is this a
 * real implementation" gate required `addEventListener`, on the strength of the
 * IDL saying `ModelContext : EventTarget`. Shipping implementations do not
 * provide it — native Chromium omits it, and the ChatGPT in-app browser's shim
 * omits it too — so the gate rejected the real thing, installed the polyfill
 * over it, and the page's tools went into a private registry. The browser's own
 * agent, reading its own registry, found nothing. `ref/webmcp-blackjack` works
 * in that browser precisely because it never replaces what it finds.
 *
 * Three shapes, injected before the app boots:
 *
 *  1. a native-ish implementation WITHOUT addEventListener -> must be adopted,
 *     and must receive the page's registrations.
 *  2. nothing at all -> the polyfill installs, as before.
 *  3. an implementation that arrives LATE, the way a shell attaches its shim
 *     when its agent attaches to the tab -> must be adopted and re-registered
 *     into, or the agent sees an empty page.
 *
 *   cd hackathon/agentic-voice-application && npm run build
 *   npx vite preview --port 3270 --strictPort --host 127.0.0.1
 *   cd tools/screenshots && node voice-native-adoption-verify.mjs
 *
 * No API key, no microphone, no socket.
 */

import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://127.0.0.1:3270';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

/**
 * A stand-in for what a browser or shell installs: the three methods and no
 * EventTarget surface, recording what the page registers into it.
 */
const FAKE_NATIVE = `(() => {
  const registered = [];
  const impl = {
    __fake: true,
    registerTool(tool) { registered.push(tool.name); return Promise.resolve(); },
    getTools() { return Promise.resolve(registered.map((name) => ({ name, description: name, title: name }))); },
    executeTool() { return Promise.resolve('{}'); },
  };
  window.__fakeNativeNames = registered;
  return impl;
})()`;

// --- 1. present before boot, and missing addEventListener -------------------

const page = await browser.newPage();
await page.evaluateOnNewDocument(`
  Object.defineProperty(document, 'modelContext', {
    value: ${FAKE_NATIVE}, configurable: true, writable: true, enumerable: false,
  });
`);
await page.goto(URL, { waitUntil: 'networkidle0' });
await wait(1500);

const early = await page.evaluate(() => ({
  stillOurs: Boolean(document.modelContext && document.modelContext.__fake),
  registered: (window.__fakeNativeNames ?? []).length,
  names: (window.__fakeNativeNames ?? []).slice(0, 3),
}));
check(
  early.stillOurs,
  'a native implementation without addEventListener is left in place, not replaced'
);
check(
  early.registered > 0,
  `and the page registered its tools into it (${early.registered}: ${early.names.join(', ')})`
);

const earlyErrors = await page.evaluate(() => window.__pageErrors ?? []);
check(!earlyErrors.length, `no error from the missing EventTarget surface: ${earlyErrors.join(' | ') || 'none'}`);

// --- 2. nothing there: the polyfill still installs --------------------------

const plain = await browser.newPage();
await plain.goto(URL, { waitUntil: 'networkidle0' });
await wait(1200);
const polyfilled = await plain.evaluate(async () => {
  const mc = document.modelContext;
  return { present: Boolean(mc), tools: mc ? (await mc.getTools()).length : 0 };
});
check(polyfilled.present && polyfilled.tools > 0, `with no implementation present the polyfill installs and registers (${polyfilled.tools} tools)`);

// --- 3. injected late, the way an agent attaching to a tab does -------------

const late = await browser.newPage();
const lateErrors = [];
late.on('pageerror', (e) => lateErrors.push(e.message));
await late.goto(URL, { waitUntil: 'networkidle0' });
await wait(1200);
await late.evaluate(`
  Object.defineProperty(document, 'modelContext', {
    value: ${FAKE_NATIVE}, configurable: true, writable: true, enumerable: false,
  });
`);
// The watcher polls once a second for ten seconds.
await wait(4000);

const adopted = await late.evaluate(() => ({
  stillTheirs: Boolean(document.modelContext && document.modelContext.__fake),
  registered: (window.__fakeNativeNames ?? []).length,
}));
check(adopted.stillTheirs, 'an implementation injected after load keeps the property');
check(
  adopted.registered > 0,
  `and the page re-registered into it, so an agent attaching later sees the tools (${adopted.registered})`
);
check(!lateErrors.length, `no page error across the adoption: ${lateErrors.join(' | ') || 'none'}`);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall checks passed');
