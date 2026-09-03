/**
 * The polyfill has to install under a browser that already owns
 * `document.modelContext`.
 *
 * ChatGPT's browser puts its own `modelContext` on the document as a
 * *non-configurable* property, and what it puts there does not answer the
 * spec's interface. `setupWebMCPPolyfill()` ran `Object.defineProperty` over
 * it, which throws `TypeError: Cannot redefine property: modelContext` — at
 * module scope, before React renders, so the whole page was blank there while
 * Chrome was fine. This asserts the three shapes a shell can leave behind.
 *
 *   cd hackathon/agentic-voice-application && npm run build
 *   npx vite preview --port 3260 --strictPort --host 127.0.0.1
 *   cd verify && node voice-install-verify.mjs
 */

import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://127.0.0.1:3260';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A stub that passes `'modelContext' in document` and fails the duck-type:
 * `provideContext` was the shape of an older WebMCP draft, and it carries none
 * of `registerTool` / `getTools` / `executeTool`.
 */
const STUB = (writable) => `
  Object.defineProperty(document, 'modelContext', {
    value: { provideContext() {} },
    configurable: false,
    writable: ${writable},
    enumerable: false,
  });
`;

const CASES = [
  ['no shell (plain Chrome)', null],
  ['shell stub, non-configurable but writable', STUB(true)],
  ['shell stub, non-configurable and read-only', STUB(false)],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

for (const [label, inject] of CASES) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

  if (inject) await page.evaluateOnNewDocument(inject);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await wait(1200);

  const errors = logs.filter((l) => l.startsWith('pageerror'));
  check(errors.length === 0, `${label}: boots without a page error ${errors[0] ?? ''}`);

  // The page rendered at all — a `defineProperty` throw at module scope leaves
  // #root empty, which no amount of console reading would tell you.
  const rendered = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
  check(rendered > 0, `${label}: React rendered into #root`);

  // The boot self-check only passes if the registry it read has the real
  // tools in it, so this is the assertion that the polyfill is reachable.
  const selfCheck = logs.find((l) => l.includes('tools self-check passed'));
  check(Boolean(selfCheck), `${label}: tools self-check passed — ${selfCheck ?? 'never logged'}`);

  await page.close();
}

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
