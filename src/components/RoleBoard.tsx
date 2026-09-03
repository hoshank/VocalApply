import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react';
import type { ApplicantProfile, JobPosting } from '../data/types';
import { formatSalary } from '../data/types';
import { matchOpenings, type RoleFilters } from '../lib/matchOpenings';

/**
 * The board, and the reason it exists twice over: a person filters it here with
 * the controls below, and an agent filters it through `find_matching_roles`.
 * Both call `matchOpenings` with the same argument shape, so a shortlist read
 * out loud can be reproduced by hand. Do not add a second search path.
 *
 * The filter form deliberately carries no `toolname`. A declarative form tool
 * here would give an agent a second, subtly different way to run the same
 * search, and the imperative tool already covers it.
 */

export interface FilterState {
  search: string;
  workMode: '' | JobPosting['workMode'];
  employment: '' | JobPosting['employment'];
  location: string;
  minSalary: string;
  currency: string;
  rankByProfile: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  search: '',
  workMode: '',
  employment: '',
  location: '',
  minSalary: '',
  currency: '',
  rankByProfile: false,
};

interface RoleBoardProps {
  roles: JobPosting[];
  applicant: ApplicantProfile;
  onOpenRole: (role: JobPosting) => void;
  /**
   * Controlled by App, because `find_matching_roles` sets them too. A person
   * and an agent driving two different copies of the same search is how the
   * board ends up showing nine roles while the agent talks about two.
   */
  filters: FilterState;
  onFiltersChange: (next: FilterState) => void;
  /** The role the agent is currently reading out, ringed and scrolled to. */
  currentRoleId: string | null;
  /** The sample-person switcher, slotted between the hero and the board. */
  children?: ReactNode;
  /** The voice and typing docks, sticky beside the listings. */
  aside?: ReactNode;
}

const EMPTY = EMPTY_FILTERS;

const CONTROL =
  'w-full rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2.5 ' +
  'text-[0.9375rem] leading-6 text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] ' +
  'transition-colors hover:border-[var(--color-ink-faint)] focus-visible:border-[var(--color-accent)]';

const WORK_MODE_LABEL: Record<JobPosting['workMode'], string> = {
  onsite: 'On site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

const EMPLOYMENT_LABEL: Record<JobPosting['employment'], string> = {
  'full-time': 'Full time',
  'part-time': 'Part time',
  'fixed-term': 'Fixed term',
};

/** Names the filter in the words a person used, for the empty state. */
const REMOVED_LABEL: Record<string, string> = {
  workMode: 'work mode',
  employment: 'contract type',
  location: 'location',
  team: 'team',
  keywords: 'your search words',
  minSalary: 'the salary floor',
  currency: 'the currency',
};

function postedLabel(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days <= 30) return `Posted ${days} days ago`;
  return `Posted ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

function FilterLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-[0.8125rem] font-medium text-[var(--color-ink-muted)]">
      {children}
    </label>
  );
}

function RoleCard({
  role,
  featured,
  ranked,
  current,
  reasons,
  onOpen,
}: {
  role: JobPosting;
  featured?: boolean;
  /** True when the ranking checkbox put this card first, rather than corpus order. */
  ranked?: boolean;
  /** The one the agent is reading out right now. */
  current?: boolean;
  reasons?: string[];
  onOpen: () => void;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [current]);

  return (
    <article
      ref={ref}
      aria-current={current ? 'true' : undefined}
      className={[
        'role-card group relative flex h-full flex-col rounded-[14px] border bg-[var(--color-surface)]',
        current
          ? 'role-card-current border-[var(--color-accent)]'
          : 'border-[var(--color-line)] hover:border-[var(--color-accent-line)] focus-within:border-[var(--color-accent)]',
        featured ? 'p-6 sm:p-7' : 'p-5',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] text-[var(--color-ink-muted)]">{role.team}</p>
        {current ? (
          <span className="shrink-0 rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[0.75rem] font-medium text-[var(--color-accent)]">
            Reading this one
          </span>
        ) : ranked ? (
          <span className="shrink-0 rounded-full border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[0.75rem] font-medium text-[var(--color-accent)]">
            Best match for you
          </span>
        ) : null}
      </div>

      <h3
        className={
          featured
            ? 'mt-2.5 text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-[var(--color-ink)] sm:text-[1.875rem]'
            : 'mt-2 text-[1.0625rem] leading-[1.3] font-semibold tracking-[-0.01em] text-[var(--color-ink)]'
        }
      >
        {/* One focusable element per card; the overlay makes the whole card the hit area. */}
        <button
          type="button"
          onClick={onOpen}
          className="text-left after:absolute after:inset-0 after:rounded-[14px] after:content-['']"
        >
          {role.title}
        </button>
      </h3>

      <p
        className={[
          'leading-relaxed text-[var(--color-ink-muted)]',
          featured ? 'mt-4 max-w-[54ch] text-[0.9375rem]' : 'mt-2.5 text-[0.875rem]',
        ].join(' ')}
      >
        {role.summary}
      </p>

      {featured ? (
        <div className="mt-6 border-t border-[var(--color-line)] pt-5">
          <h4 className="text-[0.8125rem] font-medium text-[var(--color-ink)]">The job</h4>
          <ul className="mt-3 space-y-2">
            {role.responsibilities.map((line) => (
              <li
                key={line}
                className="max-w-[50ch] pl-4 text-[0.9375rem] leading-relaxed text-[var(--color-ink-muted)] before:ml-[-1rem] before:inline-block before:w-4 before:text-[var(--color-accent)] before:content-['\2022']"
              >
                {line}
              </li>
            ))}
          </ul>

          <h4 className="mt-6 text-[0.8125rem] font-medium text-[var(--color-ink)]">What we ask for</h4>
          <ul className="mt-3 flex flex-wrap gap-2">
            {role.skills.map((skill) => (
              <li
                key={skill}
                className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-2.5 py-1 text-[0.8125rem] text-[var(--color-ink-muted)]"
              >
                {skill}
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-[46ch] text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
            {role.minYears === 0
              ? 'No prior experience needed. We will train you on site.'
              : `About ${role.minYears} years of relevant experience. We care more about the second half of that than the first.`}
          </p>
        </div>
      ) : null}

      <dl className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5">
        {[
          { term: 'Location', value: role.location },
          { term: 'Work mode', value: WORK_MODE_LABEL[role.workMode] },
          { term: 'Contract', value: EMPLOYMENT_LABEL[role.employment] },
          { term: 'Salary range', value: formatSalary(role) },
        ].map((item) => (
          <div key={item.term}>
            <dt className="sr-only">{item.term}</dt>
            <dd className="text-[0.8125rem] text-[var(--color-ink-muted)]">{item.value}</dd>
          </div>
        ))}
      </dl>

      {reasons && reasons.length > 0 ? (
        <ul className="mt-4 space-y-1 border-t border-[var(--color-line)] pt-4">
          {reasons.map((reason) => (
            <li key={reason} className="text-[0.8125rem] leading-5 text-[var(--color-accent)]">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <p className="text-[0.75rem] text-[var(--color-ink-faint)]">{postedLabel(role.postedOn)}</p>
        <span
          aria-hidden
          className="flex items-center gap-1.5 text-[0.875rem] font-medium text-[var(--color-accent)]"
        >
          Apply
          <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </article>
  );
}

export function RoleBoard({
  roles,
  applicant,
  onOpenRole,
  children,
  aside,
  filters,
  onFiltersChange,
  currentRoleId,
}: RoleBoardProps) {
  const setFilters = onFiltersChange;
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onFiltersChange({ ...filters, [key]: value });

  const currencies = useMemo(
    () => [...new Set(roles.map((role) => role.currency))].sort(),
    [roles]
  );

  // The same call the tool makes, with the same argument shape.
  const result = useMemo(() => {
    const query: RoleFilters = {
      workMode: filters.workMode || undefined,
      employment: filters.employment || undefined,
      location: filters.location.trim() || undefined,
      keywords: filters.search.trim() ? filters.search.trim().split(/\s+/) : undefined,
      minSalary: filters.minSalary.trim() ? Number(filters.minSalary) : undefined,
      currency: filters.currency || undefined,
      matchProfile: filters.rankByProfile,
    };
    return matchOpenings(roles, applicant, query);
  }, [roles, applicant, filters]);

  // Ranking is not a filter, and counting it as one made the board claim "9 of 9
  // shown" and offer to clear filters when nothing had been filtered out.
  const isFiltered = (Object.keys(EMPTY) as (keyof FilterState)[]).some(
    (key) => key !== 'rankByProfile' && filters[key] !== EMPTY[key]
  );
  const [first, ...rest] = result.matches;
  const removed = Object.entries(result.removedBy).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <section id="top" className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-10 px-5 pt-16 pb-14 sm:px-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <h1 className="max-w-[24ch] text-[2.25rem] leading-[1.06] font-semibold tracking-[-0.03em] text-balance text-[var(--color-ink)] sm:text-[3rem]">
              The interesting part is what happens when it mishears you.
            </h1>
            <p className="mt-5 max-w-[52ch] text-[1.0625rem] leading-relaxed text-[var(--color-ink-muted)]">
              We build speech recognition for real rooms, real accents and real background noise.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#openings"
                className="rounded-[10px] bg-[var(--color-accent)] px-5 py-2.5 text-[0.9375rem] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
              >
                See {roles.length} openings
              </a>
              <a
                href="#how-we-hire"
                className="rounded-[10px] border border-[var(--color-line-strong)] px-5 py-2.5 text-[0.9375rem] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-faint)]"
              >
                How we hire
              </a>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 self-center border-t border-[var(--color-line)] pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12">
            {[
              { term: 'Languages', value: 'Thirty one' },
              { term: 'Offices', value: 'Three' },
              { term: 'People', value: 'Around 180' },
              { term: 'Audio a day', value: 'Roughly 9,000 hours' },
            ].map((stat) => (
              <div key={stat.term}>
                <dt className="text-[0.8125rem] text-[var(--color-ink-muted)]">{stat.term}</dt>
                <dd className="mt-1 text-[1.375rem] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        {children}

        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
        <section id="openings" className="scroll-mt-[84px] pt-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2
              id="openings-heading"
              tabIndex={-1}
              className="text-[1.5rem] font-semibold tracking-[-0.02em] text-[var(--color-ink)]"
            >
              Open roles
            </h2>
            {/*
              The ranking checkbox used to be invisible in its effect: it
              reorders the cards below the fold and nothing at the top of the
              page said it had happened, which reads as a broken control. Both
              this line and the chip on the first card exist to answer "did that
              do anything".
            */}
            <p aria-live="polite" className="text-[0.875rem] text-[var(--color-ink-muted)]">
              {isFiltered ? `${result.matched} of ${roles.length} shown` : `${roles.length} listed`}
              {filters.rankByProfile ? `, ranked for ${applicant.name}` : ''}
            </p>
          </div>

          <search className="mt-5">
            <form
              onSubmit={(event) => event.preventDefault()}
              aria-label="Filter open roles"
              className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-5"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="lg:col-span-2">
                  <FilterLabel htmlFor="board-search">Search</FilterLabel>
                  <div className="relative mt-1.5">
                    <MagnifyingGlass
                      size={16}
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-ink-faint)]"
                    />
                    <input
                      id="board-search"
                      type="search"
                      value={filters.search}
                      onChange={(event) => set('search', event.target.value)}
                      placeholder="research, latency, accessibility"
                      className={`${CONTROL} pl-9`}
                    />
                  </div>
                </div>

                <div>
                  <FilterLabel htmlFor="board-work-mode">Work mode</FilterLabel>
                  <select
                    id="board-work-mode"
                    value={filters.workMode}
                    onChange={(event) => set('workMode', event.target.value as FilterState['workMode'])}
                    className={`${CONTROL} mt-1.5`}
                  >
                    <option value="">Any</option>
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="onsite">On site</option>
                  </select>
                </div>

                <div>
                  <FilterLabel htmlFor="board-employment">Contract</FilterLabel>
                  <select
                    id="board-employment"
                    value={filters.employment}
                    onChange={(event) =>
                      set('employment', event.target.value as FilterState['employment'])
                    }
                    className={`${CONTROL} mt-1.5`}
                  >
                    <option value="">Any</option>
                    <option value="full-time">Full time</option>
                    <option value="part-time">Part time</option>
                    <option value="fixed-term">Fixed term</option>
                  </select>
                </div>

                <div>
                  <FilterLabel htmlFor="board-location">Location</FilterLabel>
                  <input
                    id="board-location"
                    type="search"
                    value={filters.location}
                    onChange={(event) => set('location', event.target.value)}
                    placeholder="Bengaluru, London"
                    className={`${CONTROL} mt-1.5`}
                  />
                </div>

                <div>
                  <FilterLabel htmlFor="board-salary">Salary from</FilterLabel>
                  <input
                    id="board-salary"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1000}
                    value={filters.minSalary}
                    onChange={(event) => set('minSalary', event.target.value)}
                    placeholder="50000"
                    aria-describedby="board-currency-note"
                    className={`${CONTROL} mt-1.5`}
                  />
                </div>

                <div>
                  <FilterLabel htmlFor="board-currency">Currency</FilterLabel>
                  <select
                    id="board-currency"
                    value={filters.currency}
                    onChange={(event) => set('currency', event.target.value)}
                    className={`${CONTROL} mt-1.5`}
                  >
                    <option value="">Any</option>
                    {currencies.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-4">
                <label className="flex items-center gap-2.5 text-[0.875rem] text-[var(--color-ink)]">
                  <input
                    type="checkbox"
                    checked={filters.rankByProfile}
                    onChange={(event) => set('rankByProfile', event.target.checked)}
                    className="size-[18px] rounded-[5px] border border-[var(--color-line-strong)] accent-[var(--color-accent)]"
                  />
                  Sort by fit for {applicant.name}
                </label>

                {isFiltered ? (
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY)}
                    className="rounded-[10px] border border-[var(--color-line-strong)] px-3 py-1.5 text-[0.8125rem] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-faint)]"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>

              {filters.minSalary.trim() !== '' && filters.currency === '' ? (
                <p
                  id="board-currency-note"
                  className="mt-3 text-[0.8125rem] leading-5 text-[var(--color-caution)]"
                >
                  Bands are compared as plain numbers. Euros and pounds are not converted, so pick a
                  currency to compare like with like.
                </p>
              ) : null}
            </form>
          </search>

          {result.matches.length === 0 ? (
            <div className="mt-8 rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] p-8 text-center">
              <p className="text-[1.0625rem] font-medium text-[var(--color-ink)]">
                Nothing matches all of that.
              </p>
              {removed.length > 0 ? (
                <p className="mx-auto mt-2 max-w-[52ch] text-[0.9375rem] leading-relaxed text-[var(--color-ink-muted)]">
                  {removed
                    .map(([key, count]) => `${REMOVED_LABEL[key] ?? key} ruled out ${count}`)
                    .join(', ')}
                  . Relax whichever of those you care about least.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setFilters(EMPTY)}
                className="mt-5 rounded-[10px] bg-[var(--color-accent)] px-4 py-2 text-[0.875rem] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="mt-8 grid list-none grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              <li className="md:col-span-2 lg:col-span-2 lg:row-span-2">
                <RoleCard
                  role={first.role}
                  featured
                  ranked={filters.rankByProfile}
                  current={currentRoleId === first.role.id}
                  reasons={first.reasons}
                  onOpen={() => onOpenRole(first.role)}
                />
              </li>
              {rest.map((match) => (
                <li key={match.role.id}>
                  <RoleCard
                    role={match.role}
                    current={currentRoleId === match.role.id}
                    reasons={match.reasons}
                    onOpen={() => onOpenRole(match.role)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="how-we-hire" className="scroll-mt-[84px] pt-20">
          <h2 className="text-[1.5rem] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">
            How we hire
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-3">
            {[
              {
                head: 'Apply',
                body: 'Five steps, one form, no cover letter. It takes about ten minutes, and you can leave it and come back.',
              },
              {
                head: 'Talk to the team',
                body: 'Two conversations, both with people you would work beside. One of them involves listening to real call audio together.',
              },
              {
                head: 'Decide',
                body: 'You hear back either way within ten working days. If it is no, you get a reason you can use.',
              },
            ].map((item) => (
              <div key={item.head}>
                <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
                  {item.head}
                </h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--color-ink-muted)]">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>
          </div>

          <div id="applying-by-voice" className="scroll-mt-[84px] lg:sticky lg:top-[84px] lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-44 lg:pt-14">
            {aside}
          </div>
        </div>
      </div>
    </>
  );
}
