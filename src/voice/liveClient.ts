/**
 * Gemini Live over a raw WebSocket, from the browser, with no backend.
 *
 * The reference implementation this was written against (`live-dj`) runs a
 * Python server, because the server holds the API key and the SDK. This page
 * has no server and is not going to get one: the key is typed into the UI by
 * the person running the demo and lives in `sessionStorage`, exactly like the
 * sibling job-application demo's optional live mode. So the socket is opened
 * from the tab and the protocol is spoken by hand.
 *
 * Say the trade-off plainly, because the demo does too: a key in a browser tab
 * is visible to that tab. That is acceptable for a local demo with a key you
 * can revoke, and it is not how you would ship this. The production answer is
 * an ephemeral token minted server-side, which is a backend, which is the thing
 * this demo is deliberately without.
 *
 * Protocol, as of the v1beta BidiGenerateContent reference:
 *
 *   client -> server   exactly one of setup | clientContent | realtimeInput | toolResponse
 *   server -> client   exactly one of setupComplete | serverContent | toolCall |
 *                      toolCallCancellation | goAway | sessionResumptionUpdate
 *
 * The gotcha the reference repo exists to teach - `session.receive()` being a
 * per-turn async generator that silently ends after one reply - is an SDK
 * shape, not a protocol one. A raw socket has no generator to exhaust: messages
 * keep arriving on the same `onmessage` until the socket closes. The equivalent
 * mistake here is treating `turnComplete` as end-of-conversation and tearing
 * the socket down, so this file deliberately does nothing on `turnComplete`
 * except tell the UI the model stopped talking.
 */

import type { JSONSchema, JSONSchemaProperty } from '../webmcp/types';

/**
 * Current Live model. Overridable per session, and overridable for the whole app
 * via `VITE_GEMINI_LIVE_MODEL` / `VITE_GEMINI_LIVE_VOICE` in `.env`. It must be a
 * Live-capable id: a normal Flash id will not open this socket.
 */
export const LIVE_MODEL = import.meta.env.VITE_GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
export const LIVE_VOICE = import.meta.env.VITE_GEMINI_LIVE_VOICE || 'Aoede';

/**
 * How hard the model may think per turn. `minimal` | `low` | `medium` | `high`.
 * Voice has a latency budget a text form does not: thinking happens before the
 * first audio chunk, so this is silence the person hears. `high` buys correctness
 * on the refusals at the cost of that pause; drop it to `low` in `.env` if the
 * room notices the gap before the agent speaks.
 * Verified against the socket: an unknown value closes it with code 1007 and
 * `Invalid value at 'setup.generation_config.thinking_config.thinking_level'`.
 */
export const LIVE_THINKING_LEVEL =
  import.meta.env.VITE_GEMINI_LIVE_THINKING_LEVEL || 'high';

const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * Same-origin path that carries the shared-credit socket. The server adds the
 * key and proxies to `ENDPOINT`; nothing about the protocol changes, which is
 * why this file speaks the same wire format down either route.
 */
export const SHARED_RELAY_PATH = '/api/gemini-live';

// ---------------------------------------------------------------------------
// Wire shapes, only the fields this file reads
// ---------------------------------------------------------------------------

export interface GeminiSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: GeminiSchema;
}

export interface LiveFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface FunctionResponsePayload {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export type LiveEvent =
  | { type: 'ready' }
  /** 24 kHz signed 16-bit PCM, one chunk. */
  | { type: 'audio'; pcm: ArrayBuffer }
  | { type: 'transcript'; role: 'you' | 'agent'; text: string }
  /** The model stopped because the person started talking. Drop queued audio. */
  | { type: 'interrupted' }
  | { type: 'turn-complete' }
  | { type: 'tool-call'; calls: LiveFunctionCall[] }
  | { type: 'error'; message: string }
  | { type: 'closed'; code: number; reason: string };

export interface LiveSessionOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  /** `minimal` | `low` | `medium` | `high`. Defaults to `LIVE_THINKING_LEVEL`. */
  thinkingLevel?: string;
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
  onEvent: (event: LiveEvent) => void;
  /**
   * Runs the tools and resolves with one response per call. Kept as a callback
   * rather than an event so this file never learns what a tool is: it hands the
   * calls out and posts back whatever comes returns.
   */
  onToolCall: (calls: LiveFunctionCall[]) => Promise<FunctionResponsePayload[]>;
}

export interface LiveSession {
  /** 16 kHz signed 16-bit PCM from the mic worklet. */
  sendAudio(pcm: ArrayBuffer): void;
  /** A typed message, for people who cannot or would rather not speak. */
  sendText(text: string): void;
  close(): void;
  readonly model: string;
}

// ---------------------------------------------------------------------------
// JSON Schema 2020-12 (what WebMCP tools carry) -> the OpenAPI subset Gemini wants
// ---------------------------------------------------------------------------

/**
 * Chrome 151 returns `inputSchema` as a JSON string. A malformed one is a
 * declaration we cannot describe, not a session we should refuse to open.
 */
function safeParseSchema(raw: string): unknown {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Takes `unknown` because Chrome 151's native `getTools()` hands `inputSchema`
 * back as a JSON **string**, while the polyfill hands back an object. Reading
 * `.type` off the string yields undefined and `.toUpperCase()` throws - here
 * that happens inside `start()`, with the microphone already open and before a
 * single byte reaches the socket. Parse first; treat anything unusable as "no
 * schema" rather than as a crash.
 */
export function toGeminiSchema(schema: unknown): GeminiSchema {
  const parsed = typeof schema === 'string' ? safeParseSchema(schema) : schema;
  const source = (parsed ?? {}) as JSONSchema | JSONSchemaProperty;
  const mapped: GeminiSchema = { type: (source.type ?? 'object').toUpperCase() };

  if ('description' in source && source.description) mapped.description = source.description;
  if ('enum' in source && source.enum?.length) mapped.enum = source.enum.map(String);
  if ('items' in source && source.items) mapped.items = toGeminiSchema(source.items);

  if ('properties' in source && source.properties) {
    const properties: Record<string, GeminiSchema> = {};
    for (const [key, value] of Object.entries(source.properties)) {
      properties[key] = toGeminiSchema(value);
    }
    mapped.properties = properties;
    if ('required' in source && source.required?.length) mapped.required = [...source.required];
  }

  return mapped;
}

// ---------------------------------------------------------------------------
// base64, both directions. Audio is the hot path, so no data: URL round trips.
// ---------------------------------------------------------------------------

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked, because String.fromCharCode.apply blows the argument limit on a
  // buffer of any size and a per-byte string concat is measurably slower.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

interface ServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: LiveFunctionCall[] };
  toolCallCancellation?: { ids?: string[] };
  goAway?: { timeLeft?: string };
  error?: { message?: string };
}

/**
 * Opens the socket and resolves once the server has acknowledged setup. Rejects
 * if the socket closes first, which is what a bad API key looks like from here:
 * the connection is accepted and then immediately closed, with the reason in
 * the close frame rather than in an HTTP status.
 */
export async function connectLive(options: LiveSessionOptions): Promise<LiveSession> {
  const model = options.model ?? LIVE_MODEL;
  /*
    Two ways in, and they are not symmetrical.

    A key you type goes straight to Google, which is the private path: no
    audio touches our server and the key is yours.

    No key means the deployment's shared credit, and for Gemini that has to be
    a relay of the socket itself rather than a minted token. Measured twice,
    2026-09-03: `auth_tokens` mint 200 and then authenticate nothing on the
    Live socket. Every form was tried — `access_token=` and `key=`, the full
    `auth_tokens/x` resource name and the bare id, bound to a model at mint
    time and unbound, on v1beta and v1alpha — and each closes 1008 "Method
    doesn't allow unregistered callers" or 1007 "API key not valid". So there
    is no token to hand the browser; the key can only be added server-side, on
    a socket that stays open for the whole session.

    Two consequences worth being plain about, because neither applies to the
    OpenAI path (one mint call, then the browser talks to OpenAI directly):

    - **Every audio frame crosses our box**, both directions, for as long as
      the session lasts. That is the cost of Gemini having no usable token.
    - **The relay is unauthenticated**, so anyone who finds the path can spend
      the deployment's Gemini quota. Rotating `VOICE_GEMINI_KEY` is the lever
      if that happens.

    See the relay block in `deploy/Caddyfile.example`, and `server.proxy` /
    `preview.proxy` in `vite.config.ts` for the local equivalent.
  */
  const key = options.apiKey.trim();
  const shared = key === '';
  const url = shared
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${SHARED_RELAY_PATH}`
    : `${ENDPOINT}?key=${encodeURIComponent(key)}`;

  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';

  let ready = false;

  return new Promise<LiveSession>((resolve, reject) => {
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice ?? LIVE_VOICE } },
              },
              thinkingConfig: { thinkingLevel: options.thinkingLevel ?? LIVE_THINKING_LEVEL },
            },
            systemInstruction: { parts: [{ text: options.systemInstruction }] },
            tools: options.functionDeclarations.length
              ? [{ functionDeclarations: options.functionDeclarations }]
              : [],
            // Both directions, because the transcript on screen is how a person
            // checks that what the agent said matches what it did.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        })
      );
    });

    socket.addEventListener('message', async (event: MessageEvent) => {
      const text =
        typeof event.data === 'string'
          ? event.data
          : event.data instanceof Blob
            ? await event.data.text()
            : new TextDecoder().decode(event.data as ArrayBuffer);

      let message: ServerMessage;
      try {
        message = JSON.parse(text) as ServerMessage;
      } catch {
        options.onEvent({ type: 'error', message: 'The server sent something that was not JSON.' });
        return;
      }

      if (message.setupComplete !== undefined) {
        ready = true;
        options.onEvent({ type: 'ready' });
        resolve(session);
        return;
      }

      if (message.error?.message) {
        options.onEvent({ type: 'error', message: message.error.message });
        return;
      }

      const content = message.serverContent;
      if (content) {
        // Order matters for the ear, not for the code: an interruption has to
        // reach the player before the next audio chunk does.
        if (content.interrupted) options.onEvent({ type: 'interrupted' });

        const inputText = content.inputTranscription?.text;
        if (inputText) options.onEvent({ type: 'transcript', role: 'you', text: inputText });

        const outputText = content.outputTranscription?.text;
        if (outputText) options.onEvent({ type: 'transcript', role: 'agent', text: outputText });

        for (const part of content.modelTurn?.parts ?? []) {
          const data = part.inlineData?.data;
          if (!data) continue;
          // Only PCM goes to the player. An inlineData part that is not audio
          // would be rendered as noise, and "play whatever arrives" is one
          // wrong part away from a burst of static in somebody's headphones.
          const mime = part.inlineData?.mimeType ?? '';
          if (mime && !mime.startsWith('audio/')) continue;
          const pcm = fromBase64(data);
          // An odd byte length cannot be 16-bit samples, and `new Int16Array`
          // on it throws inside the message handler.
          if (pcm.byteLength % 2 !== 0) continue;
          options.onEvent({ type: 'audio', pcm });
        }

        // Deliberately not a teardown. See the note at the top of this file.
        if (content.turnComplete) options.onEvent({ type: 'turn-complete' });
      }

      if (message.toolCall?.functionCalls?.length) {
        const calls = message.toolCall.functionCalls;
        options.onEvent({ type: 'tool-call', calls });
        // Answer as fast as the tools allow: the model's voice is stalled until
        // this response lands, and a stalled voice sounds like a broken app.
        const responses = await options.onToolCall(calls);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
        }
      }
    });

    socket.addEventListener('error', () => {
      options.onEvent({ type: 'error', message: 'The connection to the model failed.' });
    });

    socket.addEventListener('close', (event: CloseEvent) => {
      options.onEvent({ type: 'closed', code: event.code, reason: event.reason });
      if (!ready) {
        reject(
          new Error(
            shared
              ? `The shared Gemini credit is not available right now (${
                  event.reason || `socket closed ${event.code}`
                }). Paste your own key above to carry on.`
              : event.reason ||
                'The session closed before it opened. That is usually a rejected API key.'
          )
        );
      }
    });

    const session: LiveSession = {
      model,
      sendAudio(pcm) {
        if (socket.readyState !== WebSocket.OPEN || !ready) return;
        socket.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: toBase64(pcm), mimeType: 'audio/pcm;rate=16000' },
            },
          })
        );
      },
      sendText(value) {
        if (socket.readyState !== WebSocket.OPEN || !ready) return;
        socket.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: value }] }],
              turnComplete: true,
            },
          })
        );
      },
      close() {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      },
    };
  });
}
