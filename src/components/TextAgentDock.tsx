import { useCallback, useRef, useState } from 'react';
import { PaperPlaneRight, Stop, Warning } from '@phosphor-icons/react';
import { runTextTurn, type GeminiContent, type TextAgentEvent } from '../lib/textAgent';

interface FeedEntry {
  id: number;
  kind: 'you' | 'agent' | 'tool';
  text: string;
  ok?: boolean;
}

interface TextAgentDockProps {
  apiKey: string;
  systemInstruction: () => string;
  toolCount: number;
}

/**
 * The typed counterpart to `VoiceDock`: same registered tools, driven by
 * Gemini's plain text API instead of a live socket. Proves the same tool
 * registry a voice agent uses is exactly what a typing agent — or, for that
 * matter, any external agent calling `document.modelContext` directly — sees.
 *
 * Reuses the Gemini key already typed into the voice dock; this is the same
 * provider, a cheaper non-live model, no reason to ask twice.
 */
export function TextAgentDock({ apiKey, systemInstruction, toolCount }: TextAgentDockProps) {
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const historyRef = useRef<GeminiContent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const feedId = useRef(0);

  const push = useCallback((entry: Omit<FeedEntry, 'id'>) => {
    feedId.current += 1;
    setFeed((current) => [...current, { ...entry, id: feedId.current }].slice(-60));
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(async () => {
    const text = typed.trim();
    if (!text || running) return;

    if (!apiKey.trim()) {
      setError('Add a Gemini API key in the Voice tab first — this reuses the same key.');
      return;
    }

    setTyped('');
    setError(null);
    push({ kind: 'you', text });
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const handle = (event: TextAgentEvent) => {
      switch (event.type) {
        case 'tool-call':
          push({ kind: 'tool', text: `→ ${event.name}` });
          break;
        case 'tool-result':
          push({ kind: 'tool', text: `${event.ok ? '✓' : '✕'} ${event.summary}`, ok: event.ok });
          break;
        case 'message':
          push({ kind: 'agent', text: event.text });
          break;
        case 'error':
          setError(event.message);
          break;
      }
    };

    await runTextTurn(text, {
      apiKey,
      systemInstruction: systemInstruction(),
      history: historyRef.current,
      signal: controller.signal,
      onEvent: handle,
    });

    abortRef.current = null;
    setRunning(false);
  }, [apiKey, push, running, systemInstruction, typed]);

  return (
    <aside className="flex h-full min-h-0 flex-col gap-4">
      <section className="flex min-h-[420px] flex-1 flex-col rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
            Type instead
          </h2>
          <span className="font-mono text-[0.6875rem] text-[var(--color-ink-faint)]">
            {toolCount} page tools
          </span>
        </div>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--color-ink-muted)]">
          Same tools as the voice agent, called from typed text instead — proof the registry does
          not care which modality is driving it. Uses the Gemini key from the Voice tab.
        </p>

        <div
          aria-live="polite"
          className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1 text-[0.875rem] leading-6"
        >
          {feed.length === 0 ? (
            <p className="text-[var(--color-ink-faint)]">
              Nothing typed yet. Try: &ldquo;fill the contact step&rdquo;.
            </p>
          ) : (
            feed.map((entry) => (
              <p key={entry.id}>
                {entry.kind === 'tool' ? (
                  <span
                    className={[
                      'font-mono text-[0.8125rem]',
                      entry.ok === false ? 'text-[var(--color-caution)]' : 'text-[var(--color-ink-faint)]',
                    ].join(' ')}
                  >
                    {entry.text}
                  </span>
                ) : (
                  <>
                    <span
                      className={[
                        'mr-2 font-mono text-[0.6875rem] tracking-[0.03em]',
                        entry.kind === 'agent' ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]',
                      ].join(' ')}
                    >
                      {entry.kind}
                    </span>
                    <span className="text-[var(--color-ink)]">{entry.text}</span>
                  </>
                )}
              </p>
            ))
          )}
        </div>

        {error ? (
          <p className="mt-3 flex items-start gap-2 rounded-[10px] border border-[var(--color-caution-line)] bg-[var(--color-caution-soft)] px-3 py-2.5 text-[0.8125rem] leading-5 text-[var(--color-caution)]">
            <Warning size={15} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="mt-4 flex gap-2"
        >
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Ask the agent to fill or correct something"
            aria-label="Type an instruction for the agent"
            disabled={running}
            className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunk)] px-3 py-2 text-[0.875rem] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus-visible:border-[var(--color-accent)] disabled:opacity-60"
          />
          {running ? (
            <button
              type="button"
              onClick={stop}
              className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-line-strong)] px-3 py-2 text-[0.8125rem] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-sunk)]"
            >
              <Stop size={15} weight="fill" aria-hidden />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={typed.trim() === ''}
              className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-3 py-2 text-[0.8125rem] font-medium text-[var(--color-paper)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PaperPlaneRight size={15} weight="fill" aria-hidden />
              Send
            </button>
          )}
        </form>
      </section>
    </aside>
  );
}
