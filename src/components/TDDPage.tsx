import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, X } from '@phosphor-icons/react';
import {
  EXPECTED,
  PROBE_ORDER,
  TARGET,
  runProbes,
  type ProbeId,
  type ProbeResult,
  type ShortlistValue,
  type Variant,
} from '../lib/probes';
import { getModelContext } from '../webmcp/polyfill';
import { buildTddTools } from '../webmcp/tddTools';
import { useWebMCP } from '../webmcp/useWebMCP';
import { ShortlistWidget } from './ShortlistWidget';
import { PrivacyNotice } from './PrivacyNotice';

const EMPTY: ShortlistValue = { email: '', startDate: '', consent: false };

const VARIANTS: { id: Variant; label: string; commit: string; note: string }[] = [
  {
    id: 'shipped',
    label: 'As shipped',
    commit: 'the version the tests were written against',
    note: 'Three probes, three passes. Nothing to see yet — this is the baseline.',
  },
  {
    id: 'cosmetic',
    label: 'Restyled',
    commit: 'refactor(ui): move shortlist onto the new design system',
    note: 'New class names, fields reordered, an extra wrapper. Identical behaviour, and a person would barely notice. The recorded selector is gone; the data-testid was kept, and it still works. This column is why "just use testids" is real advice, not a straw man.',
  },
  {
    id: 'structural',
    label: 'Fields changed',
    commit: 'feat(shortlist): split email, make sharing an explicit choice',
    note: 'One email input became two, and the consent checkbox became a select. [data-testid="email"] cannot survive that — the input it named does not exist any more, so there is nothing to rename it to. The tool call is unchanged, because it names the action and not the fields.',
  },
  {
    id: 'withdrawn',
    label: 'Feature removed',
    commit: 'feat: drop shortlisting',
    note: 'No form, no registered tool, and WebMCP fails with the other two. Correct: a test that shortlists a role should go red when the product stops offering it. Included so this page cannot be read as a claim that a tool call always survives.',
  },
];

const PROBE_COPY: Record<ProbeId, { label: string; how: string }> = {
  css: {
    label: 'Recorded selector',
    how: '.shortlist-form .applicant-email — a class off the styling system, which is what Playwright codegen and Cypress Studio emit.',
  },
  testid: {
    label: 'data-testid',
    how: '[data-testid="email"] — the discipline both tools recommend. A contract the author maintains for the test, naming an element.',
  },
  webmcp: {
    label: 'WebMCP tool call',
    how: 'getTools() → shortlist_role → executeTool(). No selector anywhere in it. Names an action.',
  },
};

/** Lets React commit, and lets a registration settle, before anything looks at the DOM. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 60));

export function TDDPage({ hasNativeWebMCP }: { hasNativeWebMCP: boolean }) {
  // index.html carries the application's title, and this page is not that page.
  useEffect(() => {
    document.title = 'Selector resilience — WebMCP';
  }, []);

  const [variant, setVariant] = useState<Variant>('shipped');
  const [value, setValue] = useState<ShortlistValue>(EMPTY);
  const [results, setResults] = useState<Partial<Record<Variant, ProbeResult[]>>>({});
  const [running, setRunning] = useState(false);

  // The tools read and write through a ref as well as through state, so a tool
  // that writes can read back what it wrote inside the same call.
  const valueRef = useRef<ShortlistValue>(EMPTY);

  const write = useCallback((next: Partial<ShortlistValue>) => {
    valueRef.current = { ...valueRef.current, ...next };
    setValue(valueRef.current);
  }, []);

  const reset = useCallback(async () => {
    valueRef.current = { ...EMPTY };
    setValue(valueRef.current);
    await settle();
  }, []);

  const tools = useMemo(
    () => buildTddTools({ read: () => valueRef.current, write }),
    [write]
  );

  // The `withdrawn` variant registers nothing. `useWebMCP` owns the lifetime
  // through an AbortController, so flipping to it aborts the scope and the tool
  // genuinely leaves the registry — this is not a flag the probe consults.
  useWebMCP(variant === 'withdrawn' ? [] : tools);

  /**
   * Polls the registry instead of sleeping a guessed interval. A page about
   * test flakiness should not itself depend on a race being won.
   */
  const awaitRegistry = useCallback(async (shouldBePresent: boolean) => {
    // No registry at all is a real state — a non-secure context, or the
    // polyfill never installed. Return and let the WebMCP probe be the thing
    // that reports it, rather than taking the other two probes down with it.
    const modelContext = getModelContext();
    if (!modelContext) return;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const registered = await modelContext.getTools();
      const present = registered.some((tool) => tool.name === 'shortlist_role');
      if (present === shouldBePresent) return;
      await settle();
    }
  }, []);

  const runOne = useCallback(
    async (target: Variant) => {
      setVariant(target);
      await settle();
      await awaitRegistry(target !== 'withdrawn');
      const observed = await runProbes({ reset, read: () => valueRef.current, settle });
      setResults((current) => ({ ...current, [target]: observed }));
      return observed;
    },
    [awaitRegistry, reset]
  );

  // `finally` in both, because every button on the page is disabled while
  // `running` is true. A throw on the way through — no model context
  // at all, most likely — would otherwise leave the page permanently inert with
  // no error on screen, which is a worse failure than the one that caused it.
  const runAll = useCallback(async () => {
    setRunning(true);
    setResults({});
    try {
      for (const entry of VARIANTS) {
        await runOne(entry.id);
      }
      // Land on the column where the two disciplines part company, rather than
      // on whichever variant happened to be last.
      setVariant('structural');
    } finally {
      setRunning(false);
    }
  }, [runOne]);

  const runCurrent = useCallback(async () => {
    setRunning(true);
    try {
      await runOne(variant);
    } finally {
      setRunning(false);
    }
  }, [runOne, variant]);

  const active = VARIANTS.find((entry) => entry.id === variant) ?? VARIANTS[0];
  const current = results[variant];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-paper)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <a
            href="./"
            className="flex items-center gap-1.5 text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)] hover:text-[var(--color-accent)]"
          >
            <ArrowLeft size={15} weight="bold" aria-hidden />
            Back to the application
          </a>
          <span className="rounded-full border border-[var(--color-line-strong)] px-2.5 py-0.5 font-mono text-[0.625rem] tracking-[0.03em] text-[var(--color-ink-faint)]">
            {hasNativeWebMCP ? 'WebMCP native' : 'WebMCP polyfilled'}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-5 py-10 sm:px-8">
        <div className="max-w-[68ch]">
          <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.025em] text-balance text-[var(--color-ink)] sm:text-[2.5rem]">
            A selector is a guess about layout. A tool is a contract.
          </h1>
          <p className="mt-4 text-[1rem] leading-relaxed text-[var(--color-ink-muted)]">
            One small feature, refactored four times, driven three ways: by a recorded CSS selector,
            by <code className="font-mono text-[0.9375rem]">data-testid</code>, and by a WebMCP tool
            call. Same target value every time. The three differ in one thing only — how they find
            what to act on — so what breaks, and when, is the whole result.
          </p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--color-ink-muted)]">
            The claim is narrow, and stated up front so nothing here has to oversell:{' '}
            <strong className="font-medium text-[var(--color-ink)]">
              this fixes one failure mode, tests that break when the markup moves.
            </strong>{' '}
            It does not help with multi-tab flows, cross-origin logins, parallelism, or setup cost,
            and it does not replace Playwright or Cypress — a WebMCP test only works on a page that
            registered tools in the first place. There is no number on this page, because nothing
            here measured one.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-2">
          {VARIANTS.map((entry) => {
            const selected = entry.id === variant;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setVariant(entry.id)}
                aria-pressed={selected}
                disabled={running}
                className={[
                  'rounded-[10px] border px-3.5 py-2 text-[0.875rem] font-medium transition-colors disabled:opacity-60',
                  selected
                    ? 'border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
                    : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)]',
                ].join(' ')}
              >
                {entry.label}
              </button>
            );
          })}

          <span className="mx-1 h-6 w-px bg-[var(--color-line)]" aria-hidden />

          <button
            type="button"
            onClick={runCurrent}
            disabled={running}
            className="rounded-[10px] border border-[var(--color-line-strong)] px-3.5 py-2 text-[0.875rem] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-sunk)] disabled:opacity-60"
          >
            Run this one
          </button>
          <button
            type="button"
            onClick={runAll}
            disabled={running}
            className="rounded-[10px] bg-[var(--color-accent)] px-3.5 py-2 text-[0.875rem] font-medium text-[var(--color-paper)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
          >
            {running ? 'Running…' : 'Run all four'}
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section>
            <p className="font-mono text-[0.75rem] text-[var(--color-ink-faint)]">
              {active.commit}
            </p>
            <div className="mt-3">
              <ShortlistWidget variant={variant} value={value} onChange={write} />
            </div>
            <p className="mt-3 text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
              {active.note}
            </p>
          </section>

          <section className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
              Three probes, one target
            </h2>
            <p className="mt-1.5 font-mono text-[0.75rem] leading-5 text-[var(--color-ink-faint)]">
              {TARGET.email} · {TARGET.startDate} · consent {String(TARGET.consent)}
            </p>

            {/* Results appear without any focus change, so nothing announces
                them otherwise. The whole page is a table of outcomes; a screen
                reader user hearing none of them has no page. */}
            <ul aria-live="polite" className="mt-4 space-y-3">
              {PROBE_ORDER.map((id) => {
                const result = current?.find((entry) => entry.id === id);
                const expected = EXPECTED[variant][id];
                const surprising = result !== undefined && result.ok !== expected;

                return (
                  <li
                    key={id}
                    className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-sunk)] p-3.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[0.9375rem] font-medium text-[var(--color-ink)]">
                        {PROBE_COPY[id].label}
                      </p>
                      {result ? (
                        <span
                          className={[
                            'flex items-center gap-1.5 font-mono text-[0.75rem]',
                            result.ok
                              ? 'text-[var(--color-accent)]'
                              : 'text-[var(--color-caution)]',
                          ].join(' ')}
                        >
                          {result.ok ? (
                            <Check size={14} weight="bold" aria-hidden />
                          ) : (
                            <X size={14} weight="bold" aria-hidden />
                          )}
                          {result.ok ? 'pass' : 'fail'}
                        </span>
                      ) : (
                        <span className="font-mono text-[0.75rem] text-[var(--color-ink-faint)]">
                          not run
                        </span>
                      )}
                    </div>

                    <p className="mt-1.5 font-mono text-[0.75rem] leading-5 text-[var(--color-ink-faint)]">
                      {PROBE_COPY[id].how}
                    </p>

                    {result ? (
                      <p
                        className={[
                          'mt-2 text-[0.8125rem] leading-5',
                          result.ok ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-caution)]',
                        ].join(' ')}
                      >
                        {result.detail}
                      </p>
                    ) : null}

                    {surprising ? (
                      <p className="mt-2 rounded-[8px] border border-[var(--color-caution-line)] bg-[var(--color-caution-soft)] px-2.5 py-2 text-[0.8125rem] leading-5 text-[var(--color-caution)]">
                        This disagrees with what the page claims should happen here. The claim is
                        wrong, or the page is broken — either way, do not trust this column.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <section className="mt-10">
          <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
            All four refactors
          </h2>
          <p className="mt-1.5 max-w-[68ch] text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
            Run all four and this fills in. The middle row is the honest one: a team that keeps
            testids is already immune to a restyle. The row below it is where the two part company,
            and the last row is the tool call failing when it should.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[0.875rem]">
              <thead>
                <tr className="border-b border-[var(--color-line-strong)]">
                  <th scope="col" className="py-2.5 pr-4 font-medium text-[var(--color-ink-muted)]">Refactor</th>
                  {PROBE_ORDER.map((id) => (
                    <th key={id} scope="col" className="py-2.5 pr-4 font-medium text-[var(--color-ink-muted)]">
                      {PROBE_COPY[id].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VARIANTS.map((entry) => (
                  <tr key={entry.id} className="border-b border-[var(--color-line)]">
                    <th scope="row" className="py-2.5 pr-4 font-normal text-[var(--color-ink)]">{entry.label}</th>
                    {PROBE_ORDER.map((id) => {
                      const result = results[entry.id]?.find((probe) => probe.id === id);
                      if (!result) {
                        return (
                          <td key={id} className="py-2.5 pr-4 font-mono text-[0.75rem] text-[var(--color-ink-faint)]">
                            —
                          </td>
                        );
                      }
                      const surprising = result.ok !== EXPECTED[entry.id][id];
                      return (
                        <td
                          key={id}
                          className={[
                            'py-2.5 pr-4 font-mono text-[0.75rem]',
                            result.ok ? 'text-[var(--color-accent)]' : 'text-[var(--color-caution)]',
                          ].join(' ')}
                        >
                          {result.ok ? 'pass' : 'fail'}
                          {surprising ? ' · unexpected' : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10 max-w-[68ch] rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
            What this costs, and what it does not buy
          </h2>
          <ul className="mt-3 space-y-2.5 text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
            <li>
              <strong className="font-medium text-[var(--color-ink)]">
                The tool survived because somebody keeps it working.
              </strong>{' '}
              Here the page kept one email field behind two inputs, so{' '}
              <code className="font-mono text-[0.8125rem]">execute</code> needed no edit. Split the
              model as well as the markup and that is where you would recompose it. A contract is
              maintained, not granted.
            </li>
            <li>
              <strong className="font-medium text-[var(--color-ink)]">
                A tool call is not a substitute for a test that checks what a person sees.
              </strong>{' '}
              It drove the form without touching the layout, which also means it proved nothing
              about the layout. Both kinds of test still have a job.
            </li>
            <li>
              <strong className="font-medium text-[var(--color-ink)]">
                It only works where tools exist.
              </strong>{' '}
              No registered tools, no test. That is the real adoption cost, and it is why this
              complements a selector-based suite rather than replacing one.
            </li>
            <li>
              <strong className="font-medium text-[var(--color-ink)]">
                Nothing here is measured.
              </strong>{' '}
              No pass-rate figure, no speed claim. Twelve cells, run live in your browser, and{' '}
              <code className="font-mono text-[0.8125rem]">tools/screenshots/verify-tdd.mjs</code>{' '}
              fails the repo if any of them stops matching what this page says.
            </li>
          </ul>
        </section>
      </main>

      <footer className="border-t border-[var(--color-line)] px-5 py-8 text-center sm:px-8">
        <p className="text-[0.8125rem] leading-relaxed text-[var(--color-ink-muted)]">
          The probes run in this tab against this page. Nothing is sent anywhere, and the widget is
          invented — there is no shortlist and no hiring team.
        </p>
      </footer>

      <PrivacyNotice />
    </div>
  );
}
