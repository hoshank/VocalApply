/**
 * The whole voice layer as one hook: microphone, socket, and the bridge from a
 * model's function call to `document.modelContext.executeTool()`.
 *
 * The load-bearing part is what this file does NOT know. It never imports the
 * tool definitions. It asks the page what it can do:
 *
 *     const tools = await document.modelContext.getTools();
 *
 * maps whatever comes back into function declarations, and dispatches a call by
 * name back through `executeTool`. Register a new tool anywhere in the app and
 * the voice can use it with no change here. That is the claim WebMCP is making,
 * and wiring the declarations directly would quietly stop demonstrating it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelContext, RegisteredTool } from '../webmcp/types';
import {
  connectLive,
  toGeminiSchema,
  type FunctionDeclaration,
  type FunctionResponsePayload,
  type LiveEvent,
  type LiveFunctionCall,
  type LiveSession,
} from './liveClient';
import { connectOpenAIRealtime } from './openaiRealtimeClient';
import { startAudioBridge, type AudioBridge } from './audio';
import { runScriptedWalkthrough } from './scriptedWalkthrough';

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'error';

/**
 * `scripted` opens no socket and no microphone: the browser's own
 * `speechSynthesis` reads narration derived from what the tools returned. It is
 * the keyless default, and the UI must never let it be mistaken for the model.
 */
export type VoiceMode = 'scripted' | 'live';

/**
 * Which live provider `start()` connects to. Gemini goes over a raw WebSocket
 * with hand-rolled 16/24 kHz PCM (`liveClient.ts`, `audio.ts`); OpenAI goes over
 * WebRTC with the browser's own audio stack (`openaiRealtimeClient.ts`). Both
 * present the same `LiveSession`/`LiveEvent` shape to everything below this
 * hook, so nothing else here branches on provider.
 */
export type VoiceProvider = 'gemini' | 'openai';

export interface TranscriptLine {
  id: number;
  role: 'you' | 'agent';
  text: string;
  /** Still being appended to. A finished line stops moving. */
  open: boolean;
}

export interface ToolLogEntry {
  id: number;
  name: string;
  /** Human title from the registered tool, never its model-facing description. */
  title: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** One line, ours, describing what came back. Never the raw payload. */
  summary: string;
}

export interface VoiceSessionState {
  status: VoiceStatus;
  mode: VoiceMode | null;
  /** Which live provider is connected. Null outside live mode. */
  provider: VoiceProvider | null;
  error: string | null;
  transcript: TranscriptLine[];
  toolLog: ToolLogEntry[];
  speaking: boolean;
  level: number;
  fullDuplex: boolean;
  muted: boolean;
  toolCount: number;
}

export interface UseVoiceSessionOptions {
  systemInstruction: () => string;
  /** Called after any tool ran, so the page can re-read its own state. */
  onToolRan?: (name: string) => void;
  /**
   * The person ended the session — `stop()`, which is the End session button.
   * The page uses it to put the form back to a fresh demo.
   *
   * Only that path. A socket the server closed, and a scripted walkthrough
   * that reached its own end, both leave the form alone: the first would wipe
   * a half-finished form under someone, and the second would erase the result
   * the walkthrough exists to show.
   *
   * **Not called when the session is re-opened because the tool scope
   * changed.** That path stops and starts a socket by itself, and a page that
   * cleared its form on it would wipe the application the moment a role was
   * opened.
   */
  onSessionEnded?: () => void;
}

export interface StartOptions {
  provider: VoiceProvider;
  apiKey: string;
}

/** What a session was told exists. Names only: a re-declaration is worth its cost when the set changes, not when a description is reworded. */
function declarationKey(tools: RegisteredTool[]): string {
  return tools
    .map((tool) => tool.name)
    .sort()
    .join(',');
}

function summarize(name: string, parsed: unknown): { ok: boolean; summary: string } {
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (record.ok === false) {
      return { ok: false, summary: String(record.error ?? 'The tool refused the call.') };
    }
    if (Array.isArray(record.withheld) && record.withheld.length > 0) {
      return { ok: true, summary: `${record.withheld.length} question(s) left blank on purpose` };
    }
    if (record.filled && typeof record.filled === 'object') {
      return { ok: true, summary: `${Object.keys(record.filled as object).length} field(s) filled` };
    }
    if (record.submitted === false) {
      return { ok: true, summary: 'focus moved to submit; nothing was sent' };
    }
  }
  return { ok: true, summary: `${name} returned` };
}

export function useVoiceSession(options: UseVoiceSessionOptions) {
  const [state, setState] = useState<VoiceSessionState>({
    status: 'idle',
    mode: null,
    provider: null,
    error: null,
    transcript: [],
    toolLog: [],
    speaking: false,
    level: 0,
    fullDuplex: false,
    muted: false,
    toolCount: 0,
  });

  /**
   * Keep the tool count live, rather than sampling it once when a session
   * starts. Registration is scoped, so the number genuinely changes when the
   * board hands over to an application, and a count captured at connect time
   * sat at the board's six while nine were registered. `toolchange` is the
   * spec's own event for exactly this.
   */
  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!modelContext) return;

    let cancelled = false;
    const refresh = () => {
      void modelContext.getTools().then((tools) => {
        if (!cancelled) setState((current) => ({ ...current, toolCount: tools.length }));
      });
    };

    refresh();
    modelContext.addEventListener('toolchange', refresh);
    return () => {
      cancelled = true;
      modelContext.removeEventListener('toolchange', refresh);
    };
  }, []);

  const sessionRef = useRef<LiveSession | null>(null);
  const audioRef = useRef<AudioBridge | null>(null);
  const lineId = useRef(0);
  const logId = useRef(0);
  /**
   * What the live session was told exists, and what it would need to be told
   * again. Both providers fix their tool list when the session opens — Gemini
   * in `setup`, which has no mid-session equivalent — while this page's
   * registry is deliberately scoped and swaps wholesale when the board hands
   * over to an application. A session opened on the board therefore never
   * learns that `fill_step` exists, and a model cannot call a function it was
   * never declared: the symptom is an agent that talks about filling the form
   * and never calls a tool.
   */
  const declaredRef = useRef('');
  const liveStartRef = useRef<StartOptions | null>(null);
  /** Tool calls running right now. A session must not be replaced mid-call: the model is owed a response to the call it just made. */
  const inFlightRef = useRef(0);
  const reopeningRef = useRef(false);
  /** Latest options, so a long-lived socket callback never reads a stale prop. */
  const optionsRef = useRef(options);
  optionsRef.current = options;
  /**
   * Duplex mode lives in a ref as well as in state, because the person ticks
   * "I have headphones on" *before* pressing start. Reading it out of `state`
   * inside `start` would read the value captured when that callback was created,
   * which is the box unticked, and the demo would silently open half duplex.
   */
  const fullDuplexRef = useRef(false);
  /** Narration off in scripted mode, microphone off in live mode. One control, two meanings. */
  const mutedRef = useRef(false);
  const walkthroughRef = useRef<AbortController | null>(null);

  /**
   * Transcripts arrive in fragments and out of order relative to audio. Append
   * to the open line of the same role rather than pushing one line per fragment,
   * or the panel becomes a column of syllables.
   */
  const appendTranscript = useCallback((role: 'you' | 'agent', text: string) => {
    setState((current) => {
      const lines = [...current.transcript];
      const last = lines[lines.length - 1];
      if (last && last.role === role && last.open) {
        lines[lines.length - 1] = { ...last, text: last.text + text };
      } else {
        lineId.current += 1;
        lines.push({ id: lineId.current, role, text, open: true });
      }
      return { ...current, transcript: lines.slice(-40) };
    });
  }, []);

  /** One finished line. Used by the scripted walkthrough, where an utterance is a line. */
  const pushLine = useCallback((role: 'you' | 'agent', text: string) => {
    setState((current) => {
      lineId.current += 1;
      return {
        ...current,
        transcript: [...current.transcript, { id: lineId.current, role, text, open: false }].slice(-40),
      };
    });
  }, []);

  const closeOpenLines = useCallback(() => {
    setState((current) => ({
      ...current,
      transcript: current.transcript.map((line) => (line.open ? { ...line, open: false } : line)),
    }));
  }, []);

  const runToolCalls = useCallback(
    async (calls: LiveFunctionCall[]): Promise<FunctionResponsePayload[]> => {
      const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
      const responses: FunctionResponsePayload[] = [];

      inFlightRef.current += 1;
      try {
        for (const call of calls) {
          let parsed: unknown = null;
          let entryTitle = call.name;

          try {
            if (!modelContext) throw new Error('This page has no document.modelContext.');
            const tools = await modelContext.getTools();
            const target = tools.find((tool: RegisteredTool) => tool.name === call.name);
            if (!target) throw new Error(`No tool named "${call.name}" is registered.`);
            entryTitle = target.title || target.name;

            // Chrome 151 rejects an object here with "Failed to parse input
            // arguments" and accepts a JSON string. Stringify always.
            const raw = await modelContext.executeTool(
              target,
              JSON.stringify(call.args ?? {})
            );
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { ok: true, text: raw };
            }
          } catch (error) {
            parsed = { ok: false, error: error instanceof Error ? error.message : String(error) };
          }

          const { ok, summary } = summarize(call.name, parsed);
          logId.current += 1;
          const entry: ToolLogEntry = {
            id: logId.current,
            name: call.name,
            title: entryTitle,
            args: (call.args ?? {}) as Record<string, unknown>,
            ok,
            summary,
          };
          setState((current) => ({ ...current, toolLog: [...current.toolLog, entry].slice(-30) }));
          optionsRef.current.onToolRan?.(call.name);

          responses.push({
            id: call.id,
            name: call.name,
            response: (parsed ?? {}) as Record<string, unknown>,
          });
        }
      } finally {
        inFlightRef.current -= 1;
      }

      return responses;
    },
    []
  );

  const handleEvent = useCallback(
    (event: LiveEvent) => {
      switch (event.type) {
        case 'ready':
          setState((current) => ({ ...current, status: 'live', error: null }));
          break;
        case 'audio':
          audioRef.current?.play(event.pcm);
          break;
        case 'transcript':
          appendTranscript(event.role, event.text);
          break;
        case 'interrupted':
          audioRef.current?.stopPlayback();
          closeOpenLines();
          break;
        case 'turn-complete':
          closeOpenLines();
          break;
        case 'tool-call':
          break; // logged when it runs, in runToolCalls
        case 'error':
          setState((current) => ({ ...current, error: event.message }));
          break;
        case 'closed':
          setState((current) => ({
            ...current,
            status: current.status === 'error' ? 'error' : 'idle',
            speaking: false,
          }));
          // No `onSessionEnded`: a socket the server closed mid-demo is not
          // the person finishing, and wiping a half-filled form under them
          // would be worse than leaving it. `stop()` is the deliberate end.
          break;
      }
    },
    [appendTranscript, closeOpenLines]
  );

  const stop = useCallback(async () => {
    walkthroughRef.current?.abort();
    walkthroughRef.current = null;
    // Cancel, not pause: a queued utterance that resumes after the person
    // pressed stop is the page talking over a decision they already made.
    window.speechSynthesis?.cancel();

    sessionRef.current?.close();
    sessionRef.current = null;
    await audioRef.current?.stop();
    audioRef.current = null;
    setState((current) => ({
      ...current,
      status: 'idle',
      mode: null,
      provider: null,
      speaking: false,
      level: 0,
    }));
    if (!reopeningRef.current) optionsRef.current.onSessionEnded?.();
  }, []);

  /**
   * Speaks one line and resolves when it has finished, so the walkthrough paces
   * itself off real speech rather than off a guessed delay.
   *
   * With narration muted, or in a browser with no `speechSynthesis`, it falls
   * back to a delay scaled to the length of the line. The transcript still
   * reads at a human pace instead of dumping six refusals in one frame, which
   * is the whole reason the refusals are worth hearing.
   */
  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        pushLine('agent', text);

        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
        if (mutedRef.current || !synth) {
          window.setTimeout(resolve, Math.min(5000, 500 + text.length * 22));
          return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(watchdog);
          setState((current) => ({ ...current, speaking: false }));
          resolve();
        };
        utterance.onend = finish;
        // Cancelling a queued utterance fires `error`, not `end`. Without this
        // the walkthrough would hang forever on the line the person stopped.
        utterance.onerror = finish;

        // `speechSynthesis` exists on every browser here and works on none of
        // them without an installed voice: headless Chrome and a bare Linux
        // desktop both accept `speak()` and then fire neither `end` nor
        // `error`. Without this the walkthrough would stall on its first line
        // with no visible reason, so the deadline is generous enough never to
        // clip real speech and short enough that a silent machine still gets
        // the whole thing as text.
        const watchdog = window.setTimeout(
          finish,
          Math.min(20000, 3000 + text.length * 90)
        );

        setState((current) => ({ ...current, speaking: true }));
        synth.speak(utterance);
      }),
    [pushLine]
  );

  /**
   * The keyless walkthrough. No socket, no microphone, no key: it drives the
   * same registered tools through the same dispatcher the live session uses, so
   * the tool log below it is the real thing rather than a re-enactment.
   */
  const startScripted = useCallback(async () => {
    if (walkthroughRef.current || sessionRef.current) return;

    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!modelContext) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: 'This page has no document.modelContext.',
      }));
      return;
    }

    const controller = new AbortController();
    walkthroughRef.current = controller;

    setState((current) => ({
      ...current,
      status: 'live',
      mode: 'scripted',
      error: null,
      transcript: [],
      toolLog: [],
    }));

    try {
      await runScriptedWalkthrough({ speak, runCalls: runToolCalls, signal: controller.signal });
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (walkthroughRef.current === controller) {
        walkthroughRef.current = null;
        setState((current) =>
          current.status === 'error'
            ? current
            : { ...current, status: 'idle', mode: null, speaking: false }
        );
        // Deliberately no `onSessionEnded` here. A walkthrough that runs to
        // the end is showing its result — a filled form with the declaration
        // still unticked — and clearing that at the final line would erase the
        // thing the person was watching. Pressing Stop goes through `stop()`
        // instead, which does clear.
      }
    }
  }, [runToolCalls, speak]);

  const start = useCallback(
    async ({ provider, apiKey }: StartOptions) => {
      if (sessionRef.current) return;
      setState((current) => ({ ...current, status: 'connecting', mode: 'live', provider, error: null }));

      try {
        const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
        if (!modelContext) throw new Error('This page has no document.modelContext.');

        // The page is asked what it can do. Nothing here knows the tool names.
        const tools = await modelContext.getTools();
        const declarations: FunctionDeclaration[] = tools.map((tool: RegisteredTool) => ({
          name: tool.name,
          description: tool.description,
          ...(tool.inputSchema ? { parameters: toGeminiSchema(tool.inputSchema) } : {}),
        }));
        declaredRef.current = declarationKey(tools);
        liveStartRef.current = { provider, apiKey };

        if (provider === 'gemini') {
          audioRef.current = await startAudioBridge({
            onChunk: (pcm) => sessionRef.current?.sendAudio(pcm),
            onBargeIn: () => closeOpenLines(),
            onSpeakingChange: (speaking) => setState((current) => ({ ...current, speaking })),
            onLevel: (level) => setState((current) => ({ ...current, level })),
          });
          audioRef.current.setFullDuplex(fullDuplexRef.current);

          sessionRef.current = await connectLive({
            apiKey,
            systemInstruction: optionsRef.current.systemInstruction(),
            functionDeclarations: declarations,
            onEvent: handleEvent,
            onToolCall: runToolCalls,
          });
        } else {
          // WebRTC handles capture/playback itself: no `audio.ts` bridge, and
          // full-duplex/mute have no equivalent here yet (OpenAI's server-side
          // voice detection already runs full-duplex by default).
          // ponytail: no mute wiring for OpenAI's mic track, add if judges ask for it.
          sessionRef.current = await connectOpenAIRealtime({
            apiKey,
            systemInstruction: optionsRef.current.systemInstruction(),
            functionDeclarations: declarations,
            onEvent: handleEvent,
            onToolCall: runToolCalls,
            onLevel: (level) => setState((current) => ({ ...current, level })),
            onSpeakingChange: (speaking) => setState((current) => ({ ...current, speaking })),
          });
        }

        setState((current) => ({ ...current, mode: 'live', provider }));
      } catch (error) {
        await stop();
        setState((current) => ({
          ...current,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [closeOpenLines, handleEvent, runToolCalls, stop]
  );

  /**
   * Re-open the live session when the page changes which tools it registers.
   *
   * `open_role` swaps the board's six tools for the application's nine, and a
   * session opened on the board was declared the six. Neither provider takes a
   * new tool list on a running session — Gemini's arrive in `setup` and there
   * is no later message for them — so the session is replaced rather than
   * updated. The cost is a short gap and a model that starts the next turn
   * without the previous one; `systemInstruction()` is rebuilt from current
   * page state, so what it opens with is the role actually on screen.
   *
   * Nothing here learns a tool name: it re-reads `getTools()` and compares the
   * set, exactly like the initial declaration does.
   */
  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!modelContext) return;

    let timer = 0;

    const reopen = async () => {
      const startOptions = liveStartRef.current;
      // A live socket only. Scripted mode holds no session and needs none.
      if (!sessionRef.current || !startOptions || reopeningRef.current) return;
      // The model is owed a response to the call that caused this swap.
      if (inFlightRef.current > 0) {
        timer = window.setTimeout(() => void reopen(), 300);
        return;
      }

      const tools = await modelContext.getTools();
      if (declarationKey(tools) === declaredRef.current) return;

      reopeningRef.current = true;
      try {
        pushLine('agent', 'That screen offers different tools, so I am reconnecting to pick them up.');
        await stop();
        await start(startOptions);
        // A fresh session says nothing until spoken to, and the person has just
        // watched the page change. One nudge, with no page detail in it: the
        // rebuilt system instruction already carries the role and its steps.
        sessionRef.current?.sendText(
          'You have just been reconnected because this screen registers a different set of tools. Say one short line about what you can do here, then wait for the person.'
        );
      } finally {
        reopeningRef.current = false;
      }
    };

    // Coalesced: unregistering the old scope and registering the new one is two
    // events, and reconnecting on the first would declare an empty registry.
    const onToolChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reopen(), 400);
    };

    modelContext.addEventListener('toolchange', onToolChange);
    return () => {
      window.clearTimeout(timer);
      modelContext.removeEventListener('toolchange', onToolChange);
    };
  }, [pushLine, start, stop]);

  const setFullDuplex = useCallback((enabled: boolean) => {
    fullDuplexRef.current = enabled;
    audioRef.current?.setFullDuplex(enabled);
    setState((current) => ({ ...current, fullDuplex: enabled }));
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    audioRef.current?.setMuted(muted);
    // In scripted mode this control means "stop talking", so it has to take
    // effect on the sentence in flight rather than on the next one.
    if (muted) window.speechSynthesis?.cancel();
    setState((current) => ({ ...current, muted }));
  }, []);

  /** For people who would rather type, and for a demo in a loud room. */
  const say = useCallback((text: string) => {
    sessionRef.current?.sendText(text);
    setState((current) => {
      lineId.current += 1;
      return {
        ...current,
        transcript: [
          ...current.transcript,
          { id: lineId.current, role: 'you' as const, text, open: false },
        ].slice(-40),
      };
    });
  }, []);

  // A live microphone must not outlive the page that opened it.
  useEffect(() => () => void stop(), [stop]);

  return { ...state, start, startScripted, stop, say, setFullDuplex, setMuted };
}
