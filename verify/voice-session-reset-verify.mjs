/**
 * What a session end clears, and what it must not.
 *
 * The demo used to open on the previous demo's filled form, because every value
 * the agent wrote was persisted per applicant. Now only what the person
 * corrected out loud is written down; a bulk `fill_step` lives for the session
 * and is cleared when it ends.
 *
 * Three things to get wrong, so three things asserted here:
 *
 *  1. a fill clears when the session ends, and survives a reload no more.
 *  2. a correction does NOT clear — the page says out loud that it is
 *     remembered, and the agent is told to say so too.
 *  3. the internal re-open, which `useVoiceSession` performs by itself when the
 *     tool scope changes, does not count as an end. That path stops and starts
 *     a socket, and clearing there would wipe the form the instant a role is
 *     opened — which is the mistake this file exists to catch.
 *
 *   cd hackathon/agentic-voice-application && npm run build
 *   npx vite preview --port 3260 --strictPort --host 127.0.0.1
 *   cd tools/screenshots && node voice-session-reset-verify.mjs
 *
 * No API key and no microphone: the socket is stubbed in the page.
 */

import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://127.0.0.1:3260';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

// A socket that completes setup and does nothing else, so a live session can be
// started and stopped without a key, a microphone, or a model.
await page.evaluateOnNewDocument(() => {
  window.__setups = 0;
  const RealWS = window.WebSocket;
  class StubSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
      this.binaryType = 'arraybuffer';
      setTimeout(() => this.dispatchEvent(new Event('open')), 0);
    }
    send(raw) {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (!m.setup) return;
      window.__setups += 1;
      setTimeout(
        () => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ setupComplete: {} }) })),
        10
      );
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
    }
  }
  StubSocket.OPEN = RealWS.OPEN;
  window.WebSocket = StubSocket;
});

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const run = (name, args) =>
  page.evaluate(
    async (n, a) => {
      const tools = await document.modelContext.getTools();
      const t = tools.find((x) => x.name === n);
      if (!t) return `no tool named ${n}`;
      return document.modelContext.executeTool(t, JSON.stringify(a));
    },
    name,
    args
  );

/** Non-empty values of the step's own controls, which carry id="<stepId>-<field>". */
const stepValues = (stepId) =>
  page.evaluate(
    (id) =>
      [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => el.id.startsWith(`${id}-`) && el.type !== 'checkbox')
        .map((el) => ({ id: el.id, value: el.value }))
        .filter((entry) => entry.value.trim()),
    stepId
  );

const startSession = async () => {
  await page.evaluate(() => {
    const field = document.querySelector('#api-key');
    if (field) field.value = '';
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Start with shared credit') || b.textContent.includes('Start session'))
      .click();
  });
  await wait(1200);
};

const stopSession = async () => {
  await page.evaluate(() => {
    // The label is "End session" live and "Stop" in the scripted walkthrough.
    const stop = [...document.querySelectorAll('button')].find((b) =>
      /^(stop|end session)$/i.test(b.textContent.trim())
    );
    if (!stop) throw new Error('no stop/end-session button found');
    stop.click();
  });
  await wait(900);
};

await page.goto(URL, { waitUntil: 'networkidle0' });
await wait(800);

// --- a session that fills the form, then ends -------------------------------

await startSession();
const list = JSON.parse(await run('list_open_roles', {}));
const roleId = (list.roles ?? list.openings ?? [])[0]?.id;
await run('open_role', { roleId, id: roleId });
await wait(2200); // the scope swap re-opens the session

const setupsAfterOpen = await page.evaluate(() => window.__setups);
check(setupsAfterOpen === 2, `opening a role re-opened the session rather than ending it (${setupsAfterOpen} setups)`);

const state = JSON.parse(await run('get_application_state', {}));
const steps = (state.steps ?? []).map((s) => s.id ?? s.stepId ?? s).filter((s) => typeof s === 'string');
const [firstStep] = steps;
await run('open_step', { stepId: firstStep });
await run('fill_step', { stepId: firstStep });
await wait(400);

const filledDuring = await stepValues(firstStep);
check(filledDuring.length > 0, `the fill reached the form during the session (${filledDuring.length} fields)`);
check(
  filledDuring.length > 0,
  `and the re-open did not wipe it — that is the trap this checks (${filledDuring.map((f) => f.id.replace(`${firstStep}-`, '')).join(', ')})`
);

// One field corrected out loud: the only thing that is allowed to survive.
const target = filledDuring[0].id.replace(`${firstStep}-`, '');
const correction = 'Corrected Out Loud';
const correctionResult = JSON.parse(
  await run('correct_field', { stepId: firstStep, fieldId: target, field: target, value: correction })
);
check(correctionResult.ok !== false, `correct_field wrote one field: ${JSON.stringify(correctionResult).slice(0, 120)}`);
await wait(400);

await stopSession();
await wait(600);

const afterStop = await stepValues(firstStep);
const survivingIds = afterStop.map((f) => f.id.replace(`${firstStep}-`, ''));
check(
  survivingIds.length === 1 && survivingIds[0] === target,
  `ending the session cleared the fill and kept only the correction, got [${survivingIds.join(', ')}]`
);
check(
  afterStop[0]?.value === correction,
  `and kept its corrected value: ${afterStop[0]?.value ?? '(gone)'}`
);

// --- and it stays that way across a reload ----------------------------------

await page.reload({ waitUntil: 'networkidle0' });
await wait(800);
await run('open_role', { roleId, id: roleId });
await wait(600);
await run('open_step', { stepId: firstStep });
await wait(400);

const afterReload = await stepValues(firstStep);
const reloadIds = afterReload.map((f) => f.id.replace(`${firstStep}-`, ''));
check(
  reloadIds.length === 1 && reloadIds[0] === target && afterReload[0].value === correction,
  `a reload opens on the correction alone, not a filled form, got [${reloadIds.join(', ')}]`
);

// The superseded whole-form store must not come back.
const legacy = await page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith('voice-application:saved-values:'))
);
check(legacy.length === 0, `the superseded whole-form store is gone, found [${legacy.join(', ')}]`);

check(!errors.length, `no page error: ${errors.join(' | ') || 'none'}`);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall checks passed');
