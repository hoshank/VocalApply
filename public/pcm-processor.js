/**
 * Mic capture worklet: the context's native rate (usually 48 kHz) down to the
 * 16 kHz mono PCM the Live API wants, plus an RMS level for barge-in.
 *
 * Runs on the audio thread, so it must stay allocation-light and must never
 * block. Decimation is a naive nearest-sample pick rather than a filtered
 * resample: speech recognition tolerates the aliasing, and a proper polyphase
 * filter here would be a lot of code for something nobody can hear.
 *
 * Lives in `public/` rather than `src/` on purpose: `audioWorklet.addModule()`
 * takes a URL and loads it as a classic worklet module, so it must be served
 * as-is rather than bundled.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is a global inside a worklet: the context's real rate.
    this.ratio = sampleRate / 16000;
    this.carry = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    const out = [];
    let index = this.carry;
    while (index < channel.length) {
      out.push(channel[Math.floor(index)]);
      index += this.ratio;
    }
    // Keep the fractional read position across blocks, or the stream drifts.
    this.carry = index - channel.length;

    const pcm = new Int16Array(out.length);
    let sum = 0;
    for (let i = 0; i < out.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, out[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      sum += sample * sample;
    }
    const rms = out.length ? Math.sqrt(sum / out.length) : 0;

    this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer]);
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
