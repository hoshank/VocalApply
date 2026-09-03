import type { ShortlistValue, Variant } from '../lib/probes';

/**
 * One small feature — shortlist a role — rendered four ways.
 *
 * The four variants are the commits a team would actually write, not
 * gratuitous churn invented to make a point:
 *
 * - `shipped`    what went out.
 * - `cosmetic`   a restyle. New design system, new class names, fields
 *                reordered, an extra wrapper. `data-testid` is kept, because a
 *                team with the discipline to add them keeps them.
 * - `structural` a product change. One email field becomes two, and the
 *                consent checkbox becomes a select. `[data-testid="email"]`
 *                does not survive that, and it cannot: the input it named no
 *                longer exists, so there is nothing to rename it to. That is
 *                why this variant is honest rather than rigged.
 * - `withdrawn`  the feature is gone. Everything fails, WebMCP included, and
 *                that is the correct answer.
 *
 * The value behind all four is the same `{ email, startDate, consent }`. That
 * is deliberate and it is also the limit of the claim: the tool needs no edit
 * here because the page kept one field behind two inputs. Split the model too
 * and `execute` is where you would recompose it. A tool contract is something
 * an author maintains, not immunity an author is granted.
 */
interface ShortlistWidgetProps {
  variant: Variant;
  value: ShortlistValue;
  onChange: (next: Partial<ShortlistValue>) => void;
}

const CONTROL =
  'w-full rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2.5 ' +
  'text-[0.9375rem] leading-6 text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] ' +
  'transition-colors hover:border-[var(--color-ink-faint)] focus-visible:border-[var(--color-accent)]';

const LABEL = 'block text-[0.8125rem] font-medium text-[var(--color-ink-muted)]';

const START_OPTIONS = [
  { value: '', label: 'Not answered' },
  { value: 'immediately', label: 'Immediately' },
  { value: 'two-weeks', label: 'In two weeks' },
  { value: 'one-month', label: 'In a month' },
];

/** local@domain, and an empty domain leaves the local part alone. */
function compose(local: string, domain: string): string {
  return domain ? `${local}@${domain}` : local;
}

export function ShortlistWidget({ variant, value, onChange }: ShortlistWidgetProps) {
  if (variant === 'withdrawn') {
    return (
      <div className="rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-sunk)] p-5">
        <p className="text-[0.9375rem] font-medium text-[var(--color-ink)]">
          Shortlisting was removed from this product.
        </p>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
          No form, and no registered tool. Every probe below fails, WebMCP included. A test that
          shortlists a role <em>should</em> go red when the product stops shortlisting roles — this
          column is here so the page cannot be read as a claim that a tool call always survives.
        </p>
      </div>
    );
  }

  const [local, domain] = value.email.split('@');

  const emailField =
    variant === 'structural' ? (
      // The product change: one field became two. There is no element left for
      // `[data-testid="email"]` to name.
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
        <div>
          <label htmlFor="sl-email-local" className={LABEL}>
            Work email
          </label>
          <input
            id="sl-email-local"
            data-testid="email-local"
            className={`${CONTROL} c-Field__control--email-local mt-1.5`}
            value={local ?? ''}
            onChange={(event) => onChange({ email: compose(event.target.value, domain ?? '') })}
          />
        </div>
        <span className="pb-2.5 font-mono text-[0.9375rem] text-[var(--color-ink-faint)]">@</span>
        <div>
          <label htmlFor="sl-email-domain" className={LABEL}>
            Domain
          </label>
          <input
            id="sl-email-domain"
            data-testid="email-domain"
            className={`${CONTROL} c-Field__control--email-domain mt-1.5`}
            value={domain ?? ''}
            onChange={(event) => onChange({ email: compose(local ?? '', event.target.value) })}
          />
        </div>
      </div>
    ) : (
      <div>
        <label htmlFor="sl-email" className={LABEL}>
          Work email
        </label>
        <input
          id="sl-email"
          data-testid="email"
          className={[
            CONTROL,
            'mt-1.5',
            // The only difference between `shipped` and `cosmetic` for this
            // field, and it is enough to break a recorded selector.
            variant === 'shipped' ? 'applicant-email' : 'c-Field__control--email',
          ].join(' ')}
          value={value.email}
          onChange={(event) => onChange({ email: event.target.value })}
        />
      </div>
    );

  const startField = (
    <div>
      <label htmlFor="sl-start" className={LABEL}>
        Earliest start
      </label>
      <select
        id="sl-start"
        data-testid="start-date"
        className={[
          CONTROL,
          'mt-1.5',
          variant === 'shipped' ? 'start-date' : 'c-Field__control--start',
        ].join(' ')}
        value={value.startDate}
        onChange={(event) => onChange({ startDate: event.target.value })}
      >
        {START_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  const consentField =
    variant === 'structural' ? (
      // A checkbox became a select. Even had the testid been carried over,
      // `element.click()` does not pick an option — the interaction changed,
      // not just the name.
      <div>
        <label htmlFor="sl-consent" className={LABEL}>
          Share this profile with the hiring team
        </label>
        <select
          id="sl-consent"
          data-testid="consent-choice"
          className={`${CONTROL} c-Select__control--consent mt-1.5`}
          value={value.consent ? 'yes' : 'no'}
          onChange={(event) => onChange({ consent: event.target.value === 'yes' })}
        >
          <option value="no">No, keep it private</option>
          <option value="yes">Yes, share it</option>
        </select>
      </div>
    ) : (
      <label className="flex items-start gap-3 text-[0.875rem] leading-6 text-[var(--color-ink)]">
        <input
          type="checkbox"
          data-testid="consent"
          className={[
            'mt-1 size-[18px] shrink-0 rounded-[5px] border border-[var(--color-line-strong)] accent-[var(--color-accent)]',
            variant === 'shipped' ? 'consent-box' : 'c-Checkbox__input',
          ].join(' ')}
          checked={value.consent}
          onChange={(event) => onChange({ consent: event.target.checked })}
        />
        <span>Share this profile with the hiring team</span>
      </label>
    );

  // `shipped` keeps the original class and field order. Everything after it
  // renames the form, reorders the fields, and adds a wrapper — three ordinary
  // consequences of a redesign, and three ways to break a recorded selector.
  const body =
    variant === 'shipped' ? (
      <>
        {emailField}
        {startField}
        {consentField}
      </>
    ) : (
      <div className="c-Shortlist__body space-y-4">
        {startField}
        {emailField}
        {consentField}
      </div>
    );

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className={[
        variant === 'shipped' ? 'shortlist-form' : 'c-Shortlist__form',
        'space-y-4 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5',
      ].join(' ')}
    >
      {body}
    </form>
  );
}
