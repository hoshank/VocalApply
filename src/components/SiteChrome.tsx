import type { ReactNode } from 'react';
import { PRIVACY_URL, clearAnalyticsChoice, setAnalyticsChoice } from '../lib/analytics';
import { useAnalyticsChoice } from '../lib/useAnalyticsChoice';

/**
 * The employer's own header and footer.
 *
 * The point of both is that this reads as a company's careers site rather than
 * a demo of a browser API. So the header carries a wordmark and section links
 * that go to real anchors on this page, never a fake route, and everything the
 * page needs to admit about itself is admitted once, in the footer, in plain
 * sentences.
 */

/** A monogram rather than a logo file: two letters, one rule, no image request. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-[var(--color-accent)] font-mono text-[0.8125rem] font-medium tracking-[-0.02em] text-white"
      >
        VA
      </span>
      <span className="leading-tight">
        <span className="block text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
          VocalApply
        </span>
        {compact ? null : (
          <span className="block text-[0.75rem] text-[var(--color-ink-muted)]">
            Speech recognition and voice agents
          </span>
        )}
      </span>
    </span>
  );
}

const NAV = [
  { href: '#openings', label: 'Openings' },
  { href: '#how-we-hire', label: 'How we hire' },
  { href: '#applying-by-voice', label: 'Applying by voice' },
];

export function SiteHeader({ trailing }: { trailing?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-paper)]/92 backdrop-blur">
      <div className="mx-auto flex h-[68px] max-w-[1240px] items-center gap-6 px-5 sm:px-8">
        <a href="#top" className="shrink-0 rounded-[8px]">
          <Wordmark />
        </a>

        <nav aria-label="Sections of this page" className="ml-auto hidden items-center gap-6 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[0.875rem] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto shrink-0 md:ml-0">{trailing}</div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="mx-auto max-w-[1240px] px-5 py-12 sm:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <Wordmark compact />
            <p className="mt-4 max-w-[54ch] text-[0.9375rem] leading-relaxed text-[var(--color-ink-muted)]">
              Amsterdam, London and Bengaluru. We build speech recognition for calls that happen in
              real rooms, and the tools customers use to work out why a transcript went wrong.
            </p>
          </div>

          <div className="lg:pl-8">
            <h2 className="text-[0.875rem] font-semibold text-[var(--color-ink)]">
              What this site is, honestly
            </h2>
            <p className="mt-2.5 text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
              VocalApply does not exist. Every role, salary and site here is invented, the two
              sample applicants are profiles made up for this demo rather than anybody&rsquo;s real
              details, and no application is ever sent anywhere. This is a demonstration of a draft
              web standard that lets a page offer its own functions to an AI agent, built so the
              agent can fill a form and still cannot press submit.
            </p>
            <p className="mt-3 text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
              Answers you give or correct stay in this browser, per sample person, so the form
              remembers them next time. Nothing leaves the tab except the audio of a voice session
              you start yourself, and one anonymous row saying this page was opened. No cookies, and
              nothing that can recognise you on a second visit.
            </p>
            <AnalyticsControl />
            <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.875rem]">
              <a
                href={PRIVACY_URL}
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                What we collect
              </a>
              <a href="?tdd=1" className="text-[var(--color-accent)] underline-offset-4 hover:underline">
                Why our tests survive a redesign
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * The current analytics setting, and a way to change it.
 *
 * This exists because the notice bottom right can only be answered once. A
 * consent control you cannot revisit is a click-through, not a choice, and
 * withdrawing has to be at least as easy as agreeing was. So the state is
 * always readable here and always reversible from here, including putting the
 * notice back if you would rather re-read it before deciding.
 */
function AnalyticsControl() {
  const choice = useAnalyticsChoice();

  const optedOut = choice === 'optedOut';
  const label = optedOut
    ? 'You are not being counted.'
    : choice === 'optedIn'
      ? 'You are counted, anonymously.'
      : 'You have not answered the notice yet, so the page is counted anonymously.';

  return (
    <p className="mt-3 text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
      {label}{' '}
      <button
        type="button"
        onClick={() => {
          setAnalyticsChoice(optedOut ? 'optedIn' : 'optedOut');
        }}
        className="text-[var(--color-accent)] underline underline-offset-4"
      >
        {optedOut ? 'Start counting me' : 'Stop counting me'}
      </button>
      {choice === null ? null : (
        <>
          {' · '}
          <button
            type="button"
            onClick={clearAnalyticsChoice}
            className="text-[var(--color-accent)] underline underline-offset-4"
          >
            Forget my answer
          </button>
        </>
      )}
    </p>
  );
}
