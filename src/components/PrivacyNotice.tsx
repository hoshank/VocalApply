import { PRIVACY_URL, setAnalyticsChoice } from '../lib/analytics';
import { useAnalyticsChoice } from '../lib/useAnalyticsChoice';

/**
 * The tracking notice, bottom right.
 *
 * **Not a cookie banner, because this page sets no cookies.** Asking permission
 * for cookies that do not exist would be the one dishonest sentence in an app
 * whose argument is saying plainly what it collects.
 *
 * Ten words of body on purpose. Nobody reads a paragraph in a corner box, so
 * the box answers only the two questions a person actually has — what are you
 * taking, and can I say no — and names the tool doing it. The long version is
 * one scroll away in the footer and behind the link, which is where someone who
 * wants it will look.
 *
 * It does not block the page either. A modal demanding a decision before you
 * may read anything is a dark pattern wearing a compliance hat, and nothing
 * here needs consent before the page is useful: the row is anonymous, carries
 * no cookie, and has no identifier that outlives the load.
 */
export function PrivacyNotice() {
  const choice = useAnalyticsChoice();
  if (choice !== null) return null;

  return (
    <aside
      aria-label="Tracking"
      className="fixed right-4 bottom-4 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-[14px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-4 shadow-lg shadow-black/5"
    >
      <p className="text-[0.875rem] leading-relaxed text-[var(--color-ink)]">
        We count page views with <strong className="font-semibold">PostHog</strong>. Anonymous, no
        cookies.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAnalyticsChoice('optedIn')}
          className="rounded-[10px] bg-[var(--color-accent)] px-3.5 py-1.5 text-[0.8125rem] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          Fine
        </button>
        <button
          type="button"
          onClick={() => setAnalyticsChoice('optedOut')}
          className="rounded-[10px] border border-[var(--color-line-strong)] px-3.5 py-1.5 text-[0.8125rem] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-sunk)]"
        >
          No thanks
        </button>
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-[0.8125rem] text-[var(--color-ink-muted)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
        >
          Details
        </a>
      </div>
    </aside>
  );
}
