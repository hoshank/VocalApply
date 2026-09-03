import { useId, useState } from 'react';
import {
  Microphone,
  MicrophoneSlash,
  PlayCircle,
  SpeakerHigh,
  SpeakerSlash,
  Stop,
  Warning,
} from '@phosphor-icons/react';
import type {
  TranscriptLine,
  ToolLogEntry,
  VoiceMode,
  VoiceProvider,
  VoiceStatus,
} from '../voice/useVoiceSession';
import { LIVE_MODEL } from '../voice/liveClient';
import { OPENAI_REALTIME_MODEL } from '../voice/openaiRealtimeClient';
import { PRIVACY_URL } from '../lib/analytics';

const PROVIDER_INFO: Record<VoiceProvider, { label: string; model: string; endpoint: string; hint: string }> = {
  gemini: {
    label: 'Gemini Live',
    model: LIVE_MODEL,
    endpoint: 'generativelanguage.googleapis.com',
    hint: 'Raw WebSocket, hand-rolled PCM audio',
  },
  openai: {
    label: 'OpenAI Realtime',
    model: OPENAI_REALTIME_MODEL,
    endpoint: 'api.openai.com',
    hint: 'WebRTC, browser-native audio',
  },
};

interface VoiceDockProps {
  status: VoiceStatus;
  mode: VoiceMode | null;
  provider: VoiceProvider | null;
  error: string | null;
  transcript: TranscriptLine[];
  toolLog: ToolLogEntry[];
  speaking: boolean;
  level: number;
  fullDuplex: boolean;
  muted: boolean;
  toolCount: number;
  apiKeys: Record<VoiceProvider, string>;
  onApiKeyChange: (provider: VoiceProvider, key: string) => void;
  onStart: (provider: VoiceProvider) => void;
  onStartScripted: () => void;
  onStop: () => void;
  onSay: (text: string) => void;
  onFullDuplexChange: (enabled: boolean) => void;
  onMutedChange: (muted: boolean) => void;
}

/**
 * The voice surface, and the consent gate in front of it.
 *
 * The gate is not decoration. Every other network claim this project makes is
 * "nothing leaves this tab", and turning on a microphone breaks that claim for
 * as long as the session is open. A demo about restraint that quietly opened an
 * audio socket to a third party would be making its own point against itself,
 * so the boundary is stated in full, before the mic, in the same words whether
 * or not anyone reads it.
 */
export function VoiceDock(props: VoiceDockProps) {
  const [typed, setTyped] = useState('');
  const [provider, setProvider] = useState<VoiceProvider>('gemini');
  const live = props.status === 'live';
  const connecting = props.status === 'connecting';
  const scripted = props.mode === 'scripted';
  const info = PROVIDER_INFO[provider];

  return (
    <aside className="flex h-full min-h-0 flex-col gap-4">
      <section className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
            Apply by voice
          </h2>
          <span className="ml-auto mr-2 font-mono text-[0.625rem] text-[var(--color-ink-faint)]">
            {props.toolCount} page tools
          </span>
          <span
            className={[
              'rounded-full border px-2.5 py-0.5 font-mono text-[0.625rem] tracking-[0.03em]',
              live
                ? 'border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-line-strong)] text-[var(--color-ink-faint)]',
            ].join(' ')}
          >
            {live
              ? scripted
                ? props.speaking
                  ? 'reading'
                  : 'walkthrough'
                : props.speaking
                  ? 'speaking'
                  : 'listening'
              : connecting
                ? 'connecting'
                : 'off'}
          </span>
        </div>

        {!live ? (
          <>
            {/*
              The live model leads, and the walkthrough is the fallback under
              it. It used to be the other way round, on the argument that a page
              with no key was otherwise a static form. That is still true, which
              is why the fallback is one click and not hidden, but a demo about
              talking to a page should open on the thing that actually listens.
            */}
            <div className="mt-4">
              <div role="radiogroup" aria-label="Live provider" className="flex gap-1.5 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-sunk)] p-1">
                {(Object.keys(PROVIDER_INFO) as VoiceProvider[]).map((key) => (
                  <ProviderOption
                    key={key}
                    checked={provider === key}
                    onSelect={() => setProvider(key)}
                    label={PROVIDER_INFO[key].label}
                  />
                ))}
              </div>

              <label
                htmlFor="api-key"
                className="mt-4 block text-[0.8125rem] font-medium text-[var(--color-ink-muted)]"
              >
                {info.label} API key
              </label>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={props.apiKeys[provider]}
                onChange={(event) => props.onApiKeyChange(provider, event.target.value)}
                placeholder={provider === 'gemini' ? 'paste an AI Studio auth key' : 'paste an OpenAI API key'}
                aria-describedby="api-key-note"
                className="mt-1.5 w-full rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2.5 font-mono text-[0.8125rem] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus-visible:border-[var(--color-accent)]"
              />

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => props.onStart(provider)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-[10px] bg-[var(--color-accent)] px-4 py-2.5 text-[0.9375rem] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Microphone size={17} weight="fill" aria-hidden />
                  {connecting
                    ? 'Connecting\u2026'
                    : props.apiKeys[provider].trim()
                      ? 'Start session'
                      : 'Start with shared credit'}
                </button>
                {props.apiKeys[provider] ? (
                  <button
                    type="button"
                    onClick={() => props.onApiKeyChange(provider, '')}
                    className="shrink-0 rounded-[10px] border border-[var(--color-line-strong)] px-3 py-2.5 text-[0.8125rem] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                  >
                    Forget key
                  </button>
                ) : null}
              </div>

              <p className="mt-2.5 text-[0.75rem] leading-relaxed text-[var(--color-ink-muted)]">
                {props.apiKeys[provider].trim()
                  ? 'Using your key.'
                  : provider === 'openai'
                    ? 'Leave it empty to use this demo\u2019s shared credit: the server mints a short-lived token, and no key is ever in this page. If it has run out, paste your own.'
                    : 'Leave it empty to use this demo\u2019s shared credit: the session is relayed through this site\u2019s server, which holds the key, so the audio passes through it. Gemini has no short-lived token that works, which is why its shared path cannot be direct. Paste your own key to talk to Google directly instead.'}
              </p>

              <p id="api-key-note" className="mt-2 text-[0.75rem] leading-relaxed text-[var(--color-ink-muted)]">
                {props.apiKeys[provider].trim() || provider === 'openai' ? (
                  <>
                    Goes to {info.endpoint} from your browser and nowhere else, held for this tab
                    only. This page&rsquo;s own JavaScript holds it, so use a throwaway key with a
                    budget cap and revoke it after.
                  </>
                ) : (
                  <>
                    On shared credit this session is proxied by this site&rsquo;s own server, so the
                    audio crosses it on the way to {info.endpoint}. Nothing is stored there. Paste a
                    key to keep the audio between your browser and Google.
                  </>
                )}
                {provider === 'gemini' ? ' Standard AIza keys are rejected; create a new auth key.' : ''}{' '}
                <a className="underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">
                  What this site collects
                </a>
                .
              </p>
            </div>

            <div className="mt-5 border-t border-[var(--color-line)] pt-4">
              <button
                type="button"
                onClick={props.onStartScripted}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--color-line-strong)] px-4 py-2.5 text-[0.875rem] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-sunk)]"
              >
                <PlayCircle size={16} weight="fill" aria-hidden />
                No key? Play the walkthrough
              </button>
              <p className="mt-2 text-[0.75rem] leading-relaxed text-[var(--color-ink-muted)]">
                A rehearsed sequence through the same tools, narrated by your browser.{' '}
                <strong className="font-medium text-[var(--color-ink)]">Not a model</strong>: it
                cannot answer a question, and it cannot hear the one it asks you.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-3">
              <div
                aria-hidden
                className={[
                  'grid size-12 shrink-0 place-items-center rounded-full border transition-colors',
                  props.speaking
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-line-strong)] bg-[var(--color-surface-sunk)]',
                ].join(' ')}
              >
                {/* A microphone icon in scripted mode would claim a microphone that is not open. */}
                {scripted ? (
                  props.muted ? (
                    <SpeakerSlash size={20} className="text-[var(--color-ink-muted)]" />
                  ) : (
                    <SpeakerHigh
                      size={20}
                      weight="fill"
                      className={props.speaking ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-muted)]'}
                    />
                  )
                ) : (
                  <Microphone
                    size={20}
                    weight={props.muted ? 'regular' : 'fill'}
                    className={props.speaking ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-muted)]'}
                  />
                )}
              </div>
              {scripted ? (
                <p className="text-[0.8125rem] leading-5 text-[var(--color-ink-muted)]">
                  Scripted walkthrough. No model, no microphone, nothing sent anywhere — the tool
                  calls below are real.
                </p>
              ) : (
                /* Mic level, so a silent session is visibly a silent room and not a broken socket. */
                <div
                  className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-sunk)]"
                  role="meter"
                  aria-label="Microphone level"
                  aria-valuenow={Math.round(Math.min(1, props.level * 6) * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-100"
                    style={{ width: `${Math.min(100, props.level * 600)}%` }}
                  />
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => props.onMutedChange(!props.muted)}
                className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-line-strong)] px-3 py-1.5 text-[0.8125rem] text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-faint)]"
              >
                {scripted ? (
                  props.muted ? (
                    <SpeakerSlash size={15} />
                  ) : (
                    <SpeakerHigh size={15} />
                  )
                ) : props.muted ? (
                  <MicrophoneSlash size={15} />
                ) : (
                  <Microphone size={15} />
                )}
                {scripted
                  ? props.muted
                    ? 'Narration off'
                    : 'Silence narration'
                  : props.muted
                    ? 'Unmute'
                    : 'Mute'}
              </button>
              <button
                type="button"
                onClick={props.onStop}
                className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-line-strong)] px-3 py-1.5 text-[0.8125rem] text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-faint)]"
              >
                <Stop size={15} weight="fill" />
                {scripted ? 'Stop' : 'End session'}
              </button>
              {scripted ? null : (
                <label className="flex items-center gap-2 rounded-[10px] border border-[var(--color-line-strong)] px-3 py-1.5 text-[0.8125rem] text-[var(--color-ink)]">
                  <input
                    type="checkbox"
                    checked={props.fullDuplex}
                    onChange={(event) => props.onFullDuplexChange(event.target.checked)}
                    className="size-[15px] rounded-[4px] border border-[var(--color-line-strong)] accent-[var(--color-accent)]"
                  />
                  Barge-in
                </label>
              )}
              <span className="ml-auto self-center font-mono text-[0.6875rem] text-[var(--color-ink-faint)]">
                {props.toolCount} page tools
              </span>
            </div>

            {/* Typing reaches the same session. A demo that only works out loud
                excludes the people it claims to be for. Hidden in scripted mode,
                where there is nothing on the other end to read it. */}
            {scripted ? null : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const text = typed.trim();
                if (!text) return;
                props.onSay(text);
                setTyped('');
              }}
              className="mt-4 flex gap-2"
            >
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="or type instead of talking"
                aria-label="Send a typed message to the agent"
                className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunk)] px-3 py-2 text-[0.875rem] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus-visible:border-[var(--color-accent)]"
              />
              <button
                type="submit"
                className="rounded-[10px] border border-[var(--color-line-strong)] px-3 py-2 text-[0.8125rem] text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-faint)]"
              >
                Send
              </button>
            </form>
            )}
          </>
        )}

        {props.error ? (
          <p className="mt-4 flex items-start gap-2 rounded-[10px] border border-[var(--color-caution-line)] bg-[var(--color-caution-soft)] px-3 py-2.5 text-[0.8125rem] leading-5 text-[var(--color-caution)]">
            <Warning size={15} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
            {props.error}
          </p>
        ) : null}
      </section>

      <section className="flex min-h-[220px] flex-1 flex-col rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h3 className="text-[0.8125rem] font-medium tracking-[0.01em] text-[var(--color-ink-muted)]">
          Transcript
        </h3>
        <div
          aria-live="polite"
          className="mt-3 flex-1 space-y-2.5 overflow-y-auto pr-1 text-[0.875rem] leading-6"
        >
          {props.transcript.length === 0 ? (
            <p className="text-[var(--color-ink-faint)]">
              Nothing said yet. Try: &ldquo;walk me through this application&rdquo;.
            </p>
          ) : (
            props.transcript
              .slice()
              .reverse()
              .map((line) => (
              <p key={line.id}>
                <span
                  className={[
                    'mr-2 font-mono text-[0.6875rem] tracking-[0.03em]',
                    line.role === 'agent' ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]',
                  ].join(' ')}
                >
                  {line.role}
                </span>
                <span className="text-[var(--color-ink)]">{line.text}</span>
                </p>
              ))
          )}
        </div>
      </section>

      <section className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h3 className="text-[0.8125rem] font-medium tracking-[0.01em] text-[var(--color-ink-muted)]">
          Tools it called
        </h3>
        {/*
          Titles and our own one-line summaries. Never a tool `description` and
          never a raw payload: a description is written for a model, and putting
          one in trusted product chrome - or in a voice - launders whoever wrote
          it into the site's own words.
        */}
        <ul className="mt-3 max-h-[180px] list-none space-y-2 overflow-y-auto pr-1">
          {props.toolLog.length === 0 ? (
            <li className="text-[0.8125rem] text-[var(--color-ink-faint)]">
              Every call the agent makes shows up here, newest first.
            </li>
          ) : (
            props.toolLog
              .slice()
              .reverse()
              .map((entry) => (
                <li key={entry.id} className="text-[0.8125rem] leading-5">
                  <span
                    className={[
                      'mr-2 font-mono text-[0.6875rem]',
                      entry.ok ? 'text-[var(--color-accent)]' : 'text-[var(--color-caution)]',
                    ].join(' ')}
                  >
                    {entry.ok ? '✓' : '✕'}
                  </span>
                  <span className="text-[var(--color-ink)]">{entry.title}</span>
                  <span className="text-[var(--color-ink-muted)]"> — {entry.summary}</span>
                </li>
              ))
          )}
        </ul>
      </section>
    </aside>
  );
}

function ProviderOption({
  checked,
  onSelect,
  label,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`flex-1 cursor-pointer rounded-[8px] px-3 py-1.5 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-accent)] ${
        checked
          ? 'bg-[var(--color-accent)] text-white'
          : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]'
      }`}
    >
      <input
        id={id}
        type="radio"
        name="voice-dock-provider"
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="block text-[0.8125rem] font-medium">{label}</span>
    </label>
  );
}
