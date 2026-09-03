/**
 * OpenAI's Realtime API over WebRTC, from the browser, with no backend — the
 * same "no server of ours in the path" rule `liveClient.ts` follows for Gemini.
 *
 * OpenAI's own docs describe minting the ephemeral client secret from *your*
 * server, because that call takes your standard secret key. This page has no
 * server, and the key is typed into the UI and held in `sessionStorage` exactly
 * like every other live-model key in this repo — so the same trade-off already
 * applies, and it is made explicit in the UI copy, not hidden by a relay.
 * Measured 2026-09-02: both `POST /v1/realtime/client_secrets` and
 * `POST /v1/realtime/calls` answer a CORS preflight from an arbitrary page
 * origin with `access-control-allow-origin: *`, so the mint call and the SDP
 * exchange both work directly from a browser tab. If OpenAI ever tightens that,
 * this file is where a relay would need to go back in.
 *
 * Confirmed against OpenAI's docs on 2026-09-02 (`developers.openai.com/api/docs/guides/realtime-webrtc`
 * and `.../realtime-conversations`): the mint body shape, the SDP endpoint and
 * exchange, the `session.update` tools shape, and the function-call
 * request/response shape (`response.done`'s `output` array carries complete
 * `function_call` items — no delta assembly needed). Transcript-delta and VAD
 * event names below are the long-stable Realtime API names, not independently
 * re-confirmed this session; if a build shows an empty transcript panel while
 * everything else works, that is the first place to check.
 *
 * The transport is fundamentally different from Gemini's, not just the wire
 * format: WebRTC carries audio as real media, encoded and decoded by the
 * browser's own stack. There is no 16 kHz PCM chunk to hand `sendAudio`, and no
 * 24 kHz PCM chunk to emit as an `{ type: 'audio' }` event — the mic track goes
 * straight onto the peer connection, and the remote track plays through a plain
 * `<audio>` element. Both methods exist on `LiveSession` for interface parity
 * with Gemini; `sendAudio` here is a deliberate no-op.
 */

import type { FunctionDeclaration, LiveEvent, LiveFunctionCall, LiveSession } from './liveClient';
import { mintOpenAIClientSecret } from './sharedKey';

export const OPENAI_REALTIME_MODEL =
  import.meta.env.VITE_OPENAI_REALTIME_MODEL || 'gpt-realtime';
export const OPENAI_REALTIME_VOICE = import.meta.env.VITE_OPENAI_REALTIME_VOICE || 'alloy';
/** Pinned so a retired id is a one-line env change, same as the model above. */
export const OPENAI_TRANSCRIBE_MODEL =
  import.meta.env.VITE_OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

const MINT_ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';
const SDP_ENDPOINT = 'https://api.openai.com/v1/realtime/calls';

export interface OpenAIRealtimeSessionOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
  onEvent: (event: LiveEvent) => void;
  onToolCall: (
    calls: LiveFunctionCall[]
  ) => Promise<{ id?: string; name: string; response: Record<string, unknown> }[]>;
  /** No Gemini-style `audio.ts` bridge on this path, so level/speaking arrive here instead. */
  onLevel?: (level: number) => void;
  onSpeakingChange?: (speaking: boolean) => void;
}

interface RealtimeServerEvent {
  type: string;
  error?: { message?: string };
  response?: {
    output?: Array<{
      type?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
    }>;
  };
  transcript?: string;
  delta?: string;
}

/** Mic level, tapped from a spare `AnalyserNode` on the same track WebRTC uses. Does not touch the track itself. */
function startLevelMeter(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return () => {};

  const ctx = new AudioContextCtor();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      sumSquares += centered * centered;
    }
    onLevel(Math.min(1, Math.sqrt(sumSquares / data.length) * 4));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    source.disconnect();
    void ctx.close();
  };
}

/**
 * Chrome 151's `getTools()` string-ifies `inputSchema`; the polyfill hands
 * back an object. WebMCP's `inputSchema` is already JSON Schema 2020-12, which
 * is exactly what OpenAI's function `parameters` field wants — no reshaping,
 * just make sure it is an object before it reaches `JSON.stringify`.
 */
function toOpenAIParameters(schema: unknown): Record<string, unknown> | undefined {
  const parsed = typeof schema === 'string' ? safeParse(schema) : schema;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function toOpenAITools(declarations: FunctionDeclaration[]) {
  return declarations.map((declaration) => ({
    type: 'function' as const,
    name: declaration.name,
    description: declaration.description,
    parameters: toOpenAIParameters(declaration.parameters) ?? { type: 'object', properties: {} },
  }));
}

/**
 * The `session.update` payload, as a pure function so it can be asserted
 * without a socket. It is a function for one reason: as an inline literal it
 * shipped missing `type`, and the API answered
 * `Missing required parameter: 'session.type'` only once a real key was in
 * play. `__openaiSelfCheck()` below is what now catches that.
 *
 * Two fields are load-bearing and neither is obvious:
 *
 * - **`type: 'realtime'`** is required on `session.update`, not only on the
 *   ephemeral-token mint above. The mint call had it; this one did not.
 * - **`audio.input.transcription.language`** pins the input language. Without
 *   it the transcriber auto-detects, and `gpt-realtime` follows what it thinks
 *   it heard — which is how this demo answered an English question in another
 *   language. Enabling transcription at all is also what makes
 *   `conversation.item.input_audio_transcription.completed` fire, so the "you"
 *   half of the transcript panel stays empty until this is set.
 */
export function buildSessionUpdate(options: {
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
}) {
  return {
    type: 'session.update' as const,
    session: {
      type: 'realtime' as const,
      instructions: options.systemInstruction,
      audio: {
        input: {
          transcription: { model: OPENAI_TRANSCRIBE_MODEL, language: 'en' },
        },
      },
      tools: toOpenAITools(options.functionDeclarations),
      tool_choice: 'auto' as const,
    },
  };
}

/**
 * Runs at boot, thrown in dev and logged in a build, like the other checks in
 * this project. It asserts the two fields whose absence is invisible until a
 * live key is typed in: one produced a 400, the other produced a session that
 * worked and spoke the wrong language.
 */
export function __openaiSelfCheck(): string {
  const payload = buildSessionUpdate({
    systemInstruction: 'x',
    functionDeclarations: [{ name: 'probe', description: 'probe', parameters: undefined }],
  });

  /*
    The schema must reach OpenAI as JSON Schema, lower-case types and all.
    One declaration list is handed to both providers, and Gemini's dialect
    upper-cases every `type`; when that mapping happened in the caller instead
    of in each client, OpenAI answered `invalid schema for function
    find_matching_roles` — and it named that tool only because `getTools()` is
    sorted by name, so it was the first schema its validator reached. Nothing
    about the failure pointed at the mapper.
  */
  const shaped = buildSessionUpdate({
    systemInstruction: 'x',
    functionDeclarations: [
      {
        name: 'probe',
        description: 'probe',
        parameters: {
          type: 'object',
          properties: { where: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
        },
      },
    ],
  });
  const params = shaped.session.tools[0].parameters as Record<string, unknown>;
  const props = params.properties as Record<string, Record<string, unknown>>;
  if (params.type !== 'object' || props.where.type !== 'string') {
    throw new Error(
      `openai self-check: parameters reached OpenAI in the wrong dialect (type=${String(params.type)}). ` +
        'JSON Schema uses lower-case type names; upper-case means a provider mapper ran too early.'
    );
  }
  // A JSON string is what Chrome 151's getTools() hands back for inputSchema.
  const fromString = buildSessionUpdate({
    systemInstruction: 'x',
    functionDeclarations: [
      { name: 'probe', description: 'probe', parameters: JSON.stringify({ type: 'object', properties: {} }) },
    ],
  });
  if ((fromString.session.tools[0].parameters as Record<string, unknown>).type !== 'object') {
    throw new Error('openai self-check: a stringified inputSchema did not survive the mapping');
  }

  if (payload.session.type !== 'realtime') {
    throw new Error("openai self-check: session.update is missing session.type: 'realtime'");
  }
  if (payload.session.audio?.input?.transcription?.language !== 'en') {
    throw new Error('openai self-check: input transcription language is not pinned to en');
  }
  if (payload.session.tools.length !== 1 || payload.session.tools[0].name !== 'probe') {
    throw new Error('openai self-check: tools did not map through toOpenAITools');
  }
  return 'openai realtime self-check passed: session.type set, input language pinned to en, parameters left as JSON Schema';
}

export function connectOpenAIRealtime(options: OpenAIRealtimeSessionOptions): Promise<LiveSession> {
  const model = options.model ?? OPENAI_REALTIME_MODEL;
  const voice = options.voice ?? OPENAI_REALTIME_VOICE;

  return new Promise<LiveSession>((resolve, reject) => {
    let settled = false;
    let stopLevelMeter: (() => void) | null = null;
    let micStream: MediaStream | null = null;
    let audioEl: HTMLAudioElement | null = null;
    let pc: RTCPeerConnection | null = null;
    let dc: RTCDataChannel | null = null;

    const fail = (message: string) => {
      options.onEvent({ type: 'error', message });
      if (!settled) {
        settled = true;
        reject(new Error(message));
      }
    };

    const send = (event: Record<string, unknown>) => {
      if (dc?.readyState === 'open') dc.send(JSON.stringify(event));
    };

    const cleanup = (code: number, reason: string) => {
      stopLevelMeter?.();
      stopLevelMeter = null;
      micStream?.getTracks().forEach((track) => track.stop());
      micStream = null;
      dc?.close();
      pc?.close();
      audioEl?.remove();
      audioEl = null;
      options.onEvent({ type: 'closed', code, reason });
    };

    (async () => {
      try {
        const mintBody = {
          session: {
            type: 'realtime',
            model,
            audio: { output: { voice } },
          },
        };

        /*
          No key typed means use the deployment's shared credit, which is a
          server-side relay minting a short-lived token rather than a key in
          this bundle. See sharedKey.ts. A key you typed goes straight to
          OpenAI below and never touches our box.
        */
        let ephemeralKey: string;
        if (!options.apiKey.trim()) {
          ephemeralKey = await mintOpenAIClientSecret(mintBody);
        } else {

        /*
          A `TypeError: Failed to fetch` here never reached OpenAI: the browser
          refused to send it. In this app that has meant exactly one thing, and
          it cost an afternoon to find because the message says nothing about
          the cause: the deployed `connect-src` did not list api.openai.com, so
          every OpenAI session died at this line while Gemini worked fine.

          The distinction is worth reporting, because "failed to fetch" sends
          you looking at your request and the answer is in a response header.
        */
        let mintResponse: Response;
        try {
          mintResponse = await fetch(MINT_ENDPOINT, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(mintBody),
          });
        } catch (error) {
          throw new Error(
            `The request to ${new URL(MINT_ENDPOINT).host} never left the browser (${
              error instanceof Error ? error.message : String(error)
            }). That is not an API error: check this page's Content-Security-Policy allows ` +
              `${new URL(MINT_ENDPOINT).origin} in connect-src, then check you are online.`
          );
        }

        if (!mintResponse.ok) {
          const body = await mintResponse.text();
          throw new Error(
            `OpenAI rejected the ephemeral-token request (${mintResponse.status}): ${body.slice(0, 300)}`
          );
        }

        const mint = (await mintResponse.json()) as { value?: string };
        if (!mint.value) throw new Error('OpenAI did not return an ephemeral client secret.');
        ephemeralKey = mint.value;
        }

        pc = new RTCPeerConnection();

        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.style.display = 'none';
        document.body.appendChild(audioEl);
        pc.ontrack = (event) => {
          if (audioEl) audioEl.srcObject = event.streams[0];
        };

        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of micStream.getTracks()) pc.addTrack(track, micStream);
        if (options.onLevel) stopLevelMeter = startLevelMeter(micStream, options.onLevel);

        dc = pc.createDataChannel('oai-events');

        dc.addEventListener('open', () => {
          send(
            buildSessionUpdate({
              systemInstruction: options.systemInstruction,
              functionDeclarations: options.functionDeclarations,
            })
          );
          if (!settled) {
            settled = true;
            options.onEvent({ type: 'ready' });
            resolve(session);
          }
        });

        dc.addEventListener('message', (event: MessageEvent) => {
          let message: RealtimeServerEvent;
          try {
            message = JSON.parse(event.data as string) as RealtimeServerEvent;
          } catch {
            return;
          }
          void handleServerEvent(message);
        });

        dc.addEventListener('close', () => cleanup(1000, 'data channel closed'));

        const handleServerEvent = async (message: RealtimeServerEvent) => {
          switch (message.type) {
            case 'error':
              options.onEvent({ type: 'error', message: message.error?.message ?? 'Unknown error.' });
              return;

            case 'input_audio_buffer.speech_started':
              options.onEvent({ type: 'interrupted' });
              return;

            case 'response.created':
              options.onSpeakingChange?.(true);
              return;

            // Event name per the long-stable Realtime API; some builds use
            // `response.output_audio_transcript.delta` instead — handled below too.
            case 'response.audio_transcript.delta':
            case 'response.output_audio_transcript.delta':
              if (message.delta) options.onEvent({ type: 'transcript', role: 'agent', text: message.delta });
              return;

            case 'conversation.item.input_audio_transcription.completed':
              if (message.transcript) {
                options.onEvent({ type: 'transcript', role: 'you', text: message.transcript });
              }
              return;

            case 'response.done': {
              options.onSpeakingChange?.(false);
              options.onEvent({ type: 'turn-complete' });

              const calls: LiveFunctionCall[] = (message.response?.output ?? [])
                .filter((item) => item.type === 'function_call' && item.name)
                .map((item) => ({
                  id: item.call_id,
                  name: item.name as string,
                  args: item.arguments ? (safeParse(item.arguments) as Record<string, unknown>) ?? {} : {},
                }));

              if (calls.length === 0) return;

              options.onEvent({ type: 'tool-call', calls });
              const responses = await options.onToolCall(calls);
              for (const response of responses) {
                send({
                  type: 'conversation.item.create',
                  item: {
                    type: 'function_call_output',
                    call_id: response.id,
                    output: JSON.stringify(response.response ?? {}),
                  },
                });
              }
              send({ type: 'response.create' });
              return;
            }

            default:
              return;
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpResponse = await fetch(`${SDP_ENDPOINT}?model=${encodeURIComponent(model)}`, {
          method: 'POST',
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            'Content-Type': 'application/sdp',
          },
        });

        if (!sdpResponse.ok) {
          const body = await sdpResponse.text();
          throw new Error(`OpenAI rejected the SDP offer (${sdpResponse.status}): ${body.slice(0, 300)}`);
        }

        await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });

        pc.addEventListener('connectionstatechange', () => {
          if (pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
            cleanup(1006, `WebRTC connection ${pc.connectionState}`);
          }
        });
      } catch (error) {
        cleanup(1011, error instanceof Error ? error.message : String(error));
        fail(error instanceof Error ? error.message : String(error));
      }
    })();

    const session: LiveSession = {
      model,
      // WebRTC owns mic capture once the track is on the peer connection —
      // nothing to forward here. Kept for interface parity with Gemini.
      sendAudio() {},
      sendText(text) {
        send({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
        });
        send({ type: 'response.create' });
      },
      close() {
        cleanup(1000, 'closed by caller');
      },
    };
  });
}
