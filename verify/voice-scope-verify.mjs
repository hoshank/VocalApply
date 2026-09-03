/**
 * The board-to-application handover, which is where voice broke.
 *
 * Both live providers fix their tool list when the session opens — Gemini's
 * arrive in `setup` and no later message replaces them — so a session opened
 * on the board is declared the board's six tools and can never call
 * `fill_step`. The symptom is an agent that discusses filling the form and
 * calls nothing. The fix re-opens the session on `toolchange`, so this asserts
 * the two things that fix rests on: that the swap fires the event, and that
 * the registry it swaps to really does carry working form tools.
 *
 *   cd hackathon/agentic-voice-application && npm run build
 *   npx vite preview --port 3230 --strictPort --host 127.0.0.1
 *   cd tools/screenshots && node voice-scope-verify.mjs
 *
 * Port 3230 so a running dev server or the tdd verifier need not be stopped.
 */

import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://127.0.0.1:3230';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // Fake media so the live path's microphone bridge opens without a device or
  // a permission prompt. The socket is stubbed in the page; nothing dials out.
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });

const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle0' });
await wait(1200);

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

check(!logs.some((l) => l.startsWith('pageerror')), 'no page error at boot');

// Count the toolchange events the page fires from here on, because the fix
// reconnects on that event and nothing else.
await page.evaluate(() => {
  window.__toolChanges = 0;
  document.modelContext.addEventListener('toolchange', () => {
    window.__toolChanges += 1;
  });
});

const board = await page.evaluate(async () =>
  (await document.modelContext.getTools()).map((t) => t.name).sort()
);
check(board.length === 6, `board registers 6 tools, got ${board.length}: ${board.join(',')}`);
check(!board.includes('fill_step'), 'board does not offer fill_step');

// Open a role the way the agent does, by calling the page's own tool.
const opened = await page.evaluate(async () => {
  const tools = await document.modelContext.getTools();
  const list = JSON.parse(
    await document.modelContext.executeTool(
      tools.find((t) => t.name === 'list_open_roles'),
      JSON.stringify({})
    )
  );
  const id = (list.roles ?? list.openings ?? [])[0]?.id;
  const out = await document.modelContext.executeTool(
    tools.find((t) => t.name === 'open_role'),
    JSON.stringify({ roleId: id, id })
  );
  return { id, out: JSON.parse(out) };
});
check(opened.out.ok !== false, `open_role succeeded: ${JSON.stringify(opened.out).slice(0, 160)}`);
await wait(600);

const app = await page.evaluate(async () =>
  (await document.modelContext.getTools()).map((t) => t.name).sort()
);
check(app.includes('fill_step'), `application registers fill_step, got: ${app.join(',')}`);
check(app.length === 9, `application registers 9 tools, got ${app.length}`);

const changes = await page.evaluate(() => window.__toolChanges);
check(changes > 0, `the swap fired toolchange (${changes} event(s)) — the fix has nothing to listen to otherwise`);

// The form tools themselves: fill one step and assert values reached the DOM.
const filled = await page.evaluate(async () => {
  const tools = await document.modelContext.getTools();
  const state = JSON.parse(
    await document.modelContext.executeTool(
      tools.find((t) => t.name === 'get_application_state'),
      JSON.stringify({})
    )
  );
  const stepId = (state.steps ?? [])[0]?.id ?? state.currentStepId;
  await document.modelContext.executeTool(
    tools.find((t) => t.name === 'open_step'),
    JSON.stringify({ stepId })
  );
  const out = JSON.parse(
    await document.modelContext.executeTool(
      tools.find((t) => t.name === 'fill_step'),
      JSON.stringify({ stepId })
    )
  );
  // `fill_step` resolves before React has painted the values it wrote.
  await new Promise((r) => setTimeout(r, 300));
  // Controls carry `id="<stepId>-<field>"` and no `name`, and they are not
  // descendants of the form element: read the step's own controls by id.
  const values = [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => el.id.startsWith(`${stepId}-`) && el.type !== 'checkbox')
    .map((el) => el.value)
    .filter((v) => v && v.trim());
  return { stepId, out, values };
});
check(filled.out.ok !== false, `fill_step succeeded: ${JSON.stringify(filled.out.error ?? '')}`);
check(
  Object.keys(filled.out.filled ?? {}).length > 0,
  `fill_step reported filled fields, got ${JSON.stringify(filled.out.filled)}`
);
check(filled.values.length > 0, `values actually reached the form (${filled.values.length} non-empty controls)`);


// ---------------------------------------------------------------------------
// The reconnect itself, with no API key and no microphone.
//
// `window.WebSocket` is replaced before the app boots by a stub that answers
// `setup` with `setupComplete` and records every setup it was sent. A real key
// is never needed: the client only checks the key is non-empty. What this
// proves is the thing the bug was — that the session's SECOND declaration
// carries `fill_step`, which the first one cannot.
// ---------------------------------------------------------------------------

const live = await browser.newPage();
await live.setViewport({ width: 1500, height: 1000 });
await live.evaluateOnNewDocument(() => {
  window.__setups = [];
  const Real = window.WebSocket;
  class StubSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
      this.binaryType = 'arraybuffer';
      window.__stub = this;
      setTimeout(() => this.dispatchEvent(new Event('open')), 0);
    }
    send(raw) {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (!message.setup) return;
      const declared = (message.setup.tools?.[0]?.functionDeclarations ?? []).map((d) => d.name);
      window.__setups.push(declared.sort());
      setTimeout(() => {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ setupComplete: {} }) }));
      }, 10);
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
    }
  }
  StubSocket.OPEN = Real.OPEN;
  window.WebSocket = StubSocket;
});

const liveLogs = [];
live.on('pageerror', (e) => liveLogs.push(`pageerror: ${e.message}`));
await live.goto(URL, { waitUntil: 'networkidle0' });
await wait(1000);

// Gemini is the default provider: type any key and start the session.
await live.type('#api-key', 'stub-key-not-used');
await live.evaluate(() => {
  const start = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Start session'));
  start.click();
});
await wait(1500);

const first = await live.evaluate(() => window.__setups.map((s) => s.join(',')));
check(first.length === 1, `one session opened on the board, got ${first.length}`);
check(
  first[0]?.includes('list_open_roles') && !first[0]?.includes('fill_step'),
  `the board session was declared board tools only: ${first[0]}`
);

// Open a role the way the agent would, which swaps the registry underneath.
await live.evaluate(async () => {
  const tools = await document.modelContext.getTools();
  const list = JSON.parse(
    await document.modelContext.executeTool(tools.find((t) => t.name === 'list_open_roles'), '{}')
  );
  const id = (list.roles ?? list.openings ?? [])[0]?.id;
  await document.modelContext.executeTool(
    tools.find((t) => t.name === 'open_role'),
    JSON.stringify({ roleId: id, id })
  );
});
await wait(2500);

const after = await live.evaluate(() => window.__setups.map((s) => s.join(',')));
check(after.length === 2, `the session was re-opened when the tools changed, setups seen: ${after.length}`);
check(
  after[1]?.includes('fill_step') && after[1]?.includes('open_step'),
  `the re-opened session was declared the form tools: ${after[1]}`
);
check(!liveLogs.some((l) => l.startsWith('pageerror')), `no page error across the reconnect: ${liveLogs.join(' | ')}`);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall checks passed');
