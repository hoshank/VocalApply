/**
 * The buzz, measured rather than described.
 *
 * The voice app plays each 24 kHz PCM chunk from the model as its own
 * `AudioBufferSourceNode`. If the context runs at the device rate, Chrome
 * resamples every chunk independently and the boundaries stop lining up — on a
 * 44.1 kHz device that is a discontinuity roughly fifty times a second, which
 * is heard as a buzz. Pinning the playback context to the model's own rate
 * removes the per-chunk resample.
 *
 * Two halves:
 *
 * 1. The mechanism, in an OfflineAudioContext with a 440 Hz sine, whose
 *    steepest legitimate slope is known. The 44.1 kHz mismatched case must
 *    misbehave and the matched case must not — if the mismatched case ever
 *    comes back clean, this file is measuring nothing and should be deleted.
 * 2. The app, live: the page must build a playback AudioContext at 24000. This
 *    is the half that fails if somebody folds the two contexts back into one.
 *
 *   cd hackathon/agentic-voice-application && npm run build
 *   npx vite preview --port 3240 --strictPort --host 127.0.0.1
 *   cd tools/screenshots && node voice-audio-verify.mjs
 *
 * No API key and no microphone: the socket is stubbed in the page.
 */

import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://127.0.0.1:3240';
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

// --- 1. The mechanism -------------------------------------------------------

const bench = await browser.newPage();
await bench.goto('about:blank');
const slopes = await bench.evaluate(async () => {
  const FREQ = 440;
  const MODEL = 24000;
  const CHUNK = 480; // 20 ms, the order of size the model sends

  const sine = (rate, n, offset = 0) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i += 1) a[i] = Math.sin((2 * Math.PI * FREQ * (i + offset)) / rate) * 0.5;
    return a;
  };
  const worstJump = (data, skip) => {
    let max = 0;
    for (let i = skip + 1; i < data.length - skip; i += 1) {
      const d = Math.abs(data[i] - data[i - 1]);
      if (d > max) max = d;
    }
    return max;
  };

  // Schedule chunks exactly the way audio.ts does, into a context at `outRate`.
  const run = async (outRate, bufferRate) => {
    const ctx = new OfflineAudioContext(1, outRate, outRate);
    const per = Math.round((bufferRate * CHUNK) / MODEL);
    let nextStart = 0;
    for (let c = 0; c < bufferRate / per; c += 1) {
      const buffer = ctx.createBuffer(1, per, bufferRate);
      buffer.getChannelData(0).set(sine(bufferRate, per, c * per));
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      const now = ctx.currentTime;
      if (nextStart < now) nextStart = now;
      node.start(nextStart);
      nextStart += buffer.duration;
    }
    const out = await ctx.startRendering();
    const legitimate = 0.5 * 2 * Math.PI * (FREQ / outRate);
    return worstJump(out.getChannelData(0), Math.floor(outRate * 0.05)) / legitimate;
  };

  return {
    mismatched441: await run(44100, MODEL), // one context at a 44.1 kHz device
    mismatched48: await run(48000, MODEL), // the same, where the ratio is 2:1
    matched: await run(MODEL, MODEL), // playback pinned to the model's rate
  };
});

const x = (v) => `${v.toFixed(1)}x the sine's own steepest slope`;
console.log(`\n  chunks at 24 kHz into a 44.1 kHz context : ${x(slopes.mismatched441)}`);
console.log(`  chunks at 24 kHz into a 48 kHz context   : ${x(slopes.mismatched48)}`);
console.log(`  chunks at 24 kHz into a 24 kHz context   : ${x(slopes.matched)}\n`);

check(
  slopes.mismatched441 > 3,
  `the mismatched 44.1 kHz case is measurably broken (${slopes.mismatched441.toFixed(1)}x) — if this ever passes, the probe has stopped measuring the buzz`
);
check(slopes.matched < 1.5, `pinning playback to 24 kHz is clean (${slopes.matched.toFixed(1)}x)`);

// --- 2. The app -------------------------------------------------------------

const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  window.__contextRates = [];
  const RealAC = window.AudioContext;
  window.AudioContext = class extends RealAC {
    constructor(...args) {
      super(...args);
      window.__contextRates.push(this.sampleRate);
    }
  };
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
await page.goto(URL, { waitUntil: 'networkidle0' });
await wait(800);
await page.type('#api-key', 'stub-key');
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Start session')).click();
});
await wait(2000);

const rates = await page.evaluate(() => window.__contextRates);
console.log('  AudioContext sample rates the page built:', rates.join(', ') || '(none)');
check(
  rates.includes(24000),
  `the page builds a playback context at the model's 24 kHz rate, got [${rates.join(', ')}]`
);
check(rates.length >= 2, `mic and playback are separate contexts, got ${rates.length}`);
check(!errors.length, `no page error opening the session: ${errors.join(' | ') || 'none'}`);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall checks passed');
