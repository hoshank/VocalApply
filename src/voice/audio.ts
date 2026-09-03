/**
 * Microphone in, model voice out, and the barge-in between them.
 *
 * Two rates and they are not the same: the mic goes up at 16 kHz because that
 * is what the Live API accepts, and the voice comes back at 24 kHz. So there
 * are two contexts, and the second one is not a tidiness preference — it is
 * the fix for an audible buzz.
 *
 * Playback runs in a context pinned to 24 kHz, the model's own rate, so a
 * chunk's `AudioBuffer` never needs resampling to reach the graph. One context
 * at the device rate looks simpler and buzzes: each chunk becomes its own
 * `AudioBufferSourceNode`, Chrome resamples every one of them independently,
 * and the boundaries stop lining up. Measured in an OfflineAudioContext with a
 * 440 Hz sine, largest sample-to-sample jump against what that sine can
 * legitimately produce:
 *
 *   device 48 kHz, 20 ms chunks at 24 kHz   1.0x   (integer 2:1, no artefact)
 *   device 44.1 kHz, 20 ms chunks at 24 kHz 15.7x  <- the buzz, ~50 per second
 *   buffers at the context's own rate        1.0x   (what this file now does)
 *
 * 44.1 kHz is the common case on macOS, which is why this was audible on a
 * laptop and clean on the machines that happened to run at 48 kHz. Pinning the
 * context moves the one resample into the platform's output path, where it is
 * a single continuous stream with no per-chunk boundary to break.
 *
 * The mic keeps its own context at the device's native rate: decimating from
 * there is what `pcm-processor.js` is written against, and pinning that one too
 * would have made the uplink 24 kHz -> 16 kHz on a 1.5 ratio for no reason.
 *
 * Playback is a scheduled queue rather than one buffer per chunk played
 * immediately. Chunks arrive faster than real time; starting each one at
 * `currentTime` would overlap them into noise. A running `nextStart` cursor
 * plays them back to back, and dropping the cursor is how an interruption
 * empties the queue.
 *
 * Half duplex by default, and that is a usability decision rather than a
 * technical one. Real barge-in needs headphones: on laptop speakers the model
 * hears its own voice, interrupts itself, and the demo eats its own tail in
 * front of whoever you are showing it to. So the mic is gated while the agent
 * speaks unless the person says they have headphones on.
 */

export interface AudioBridgeOptions {
  /** 16 kHz mono PCM from the worklet, ready for the socket. */
  onChunk: (pcm: ArrayBuffer) => void;
  /** The person started talking over the agent. Playback has already stopped. */
  onBargeIn: () => void;
  /** True while queued model audio is playing. Drives the orb. */
  onSpeakingChange: (speaking: boolean) => void;
  /** Throttled mic level, 0..1, for the level meter. */
  onLevel: (rms: number) => void;
}

export interface AudioBridge {
  /** Queue one 24 kHz PCM chunk from the model. */
  play(pcm: ArrayBuffer): void;
  /** Drop everything queued. Called on an interruption. */
  stopPlayback(): void;
  /** Let the mic through while the agent is speaking. Needs headphones. */
  setFullDuplex(enabled: boolean): void;
  /** Stop the mic entirely, without tearing down playback. */
  setMuted(muted: boolean): void;
  stop(): Promise<void>;
}

/** Above this RMS, while the agent is speaking, counts as talking over it. */
const BARGE_IN_RMS = 0.02;
const LEVEL_INTERVAL_MS = 100;
const MODEL_SAMPLE_RATE = 24000;

export async function startAudioBridge(options: AudioBridgeOptions): Promise<AudioBridge> {
  const context = new AudioContext();
  await context.audioWorklet.addModule('/pcm-processor.js');

  // Playback only, pinned to the model's rate. See the note at the top.
  const playback = new AudioContext({ sampleRate: MODEL_SAMPLE_RATE });
  // A context created outside a gesture can start suspended, and a suspended
  // playback context queues chunks silently rather than failing.
  if (playback.state === 'suspended') await playback.resume().catch(() => {});

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const source = context.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(context, 'pcm-processor');

  let speaking = false;
  let fullDuplex = false;
  let muted = false;
  let nextStart = 0;
  let lastLevelAt = 0;
  let active: AudioBufferSourceNode[] = [];

  const setSpeaking = (value: boolean) => {
    if (speaking === value) return;
    speaking = value;
    options.onSpeakingChange(value);
  };

  const stopPlayback = () => {
    for (const node of active) {
      try {
        node.stop();
      } catch {
        // Already ended. Stopping a finished source throws and means nothing.
      }
    }
    active = [];
    nextStart = 0;
    setSpeaking(false);
  };

  worklet.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
    const { pcm, rms } = event.data;

    const now = performance.now();
    if (now - lastLevelAt >= LEVEL_INTERVAL_MS) {
      lastLevelAt = now;
      options.onLevel(rms);
    }

    if (muted) return;

    if (speaking) {
      if (!fullDuplex) return; // half duplex: the model does not hear itself
      if (rms >= BARGE_IN_RMS) {
        stopPlayback();
        options.onBargeIn();
      }
    }

    options.onChunk(pcm);
  };

  source.connect(worklet);
  // Keeps the graph alive without routing the mic to the speakers. A worklet
  // with no downstream connection is allowed to stop being pulled.
  const sink = context.createGain();
  sink.gain.value = 0;
  worklet.connect(sink);
  sink.connect(context.destination);

  return {
    play(pcm) {
      const samples = new Int16Array(pcm);
      if (samples.length === 0) return;

      const floats = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i += 1) floats[i] = samples[i] / 0x8000;

      const buffer = playback.createBuffer(1, floats.length, MODEL_SAMPLE_RATE);
      buffer.getChannelData(0).set(floats);

      const node = playback.createBufferSource();
      node.buffer = buffer;
      node.connect(playback.destination);

      const now = playback.currentTime;
      if (nextStart < now) nextStart = now;
      node.start(nextStart);
      nextStart += buffer.duration;

      active.push(node);
      setSpeaking(true);
      node.onended = () => {
        active = active.filter((entry) => entry !== node);
        if (active.length === 0) setSpeaking(false);
      };
    },
    stopPlayback,
    setFullDuplex(enabled) {
      fullDuplex = enabled;
    },
    setMuted(value) {
      muted = value;
    },
    async stop() {
      stopPlayback();
      worklet.port.onmessage = null;
      worklet.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      await context.close();
      await playback.close();
    },
  };
}
