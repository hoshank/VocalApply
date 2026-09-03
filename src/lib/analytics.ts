/**
 * Analytics. The whole thing is here, in one short file, on purpose.
 *
 * Every other demo in this workspace argues that a site should collect the
 * minimum it needs and say so plainly. A submission making that argument cannot
 * ship a 50 kB third-party SDK whose behaviour a reader has to take on trust, so
 * this is a hand-written POST to PostHog's capture endpoint and nothing else.
 * You can audit what leaves this page by reading fifty lines.
 *
 * What it does NOT do, and cannot be configured to do:
 *
 *   - **No cookie, ever.** Nothing here reads or writes one.
 *   - **One localStorage key, and only about consent.** `analytics-choice`
 *     records that you answered the notice, because an opt-out you have to
 *     repeat on every page load is not an opt-out. It holds one of two words
 *     and never an identifier, so it cannot be used to recognise you. Nothing
 *     else about analytics touches the device: no cookie, no session storage,
 *     no fingerprint.
 *   - **No autocapture.** Nothing is observed. Only the events named in
 *     `AppEvent` below can ever be sent, and each one is an explicit call at a
 *     line you can grep for. This is the same discipline the sibling job demo
 *     uses for its refusal rules: an authored list, never a classifier.
 *   - **No session recording.** Ever. Two of these demos render synthetic
 *     applicants with sensitive fields, and a replay tool anywhere near them
 *     would be indefensible whatever the payload actually contained.
 *   - **No identifier that outlives the page.** `distinct_id` is a random UUID
 *     minted per document load and held in memory. Reload the page and you are
 *     a different row. The honest cost: unique-visitor counts here are
 *     meaningless, and we do not report them.
 *   - **No form values, no tool inputs, no tool outputs, no free text.** The
 *     property allowlist is the `arrival()` function and the literal objects at
 *     the call sites, both visible below.
 *
 * `$process_person_profile: false` marks every event anonymous, so PostHog
 * builds no person profile behind it.
 *
 * Opt out: press the button in the notice, or send Global Privacy Control or Do
 * Not Track, and this module returns before it builds a request. Or omit `VITE_POSTHOG_KEY` at build
 * time and the whole module is a no-op. The key it reads is a PostHog *project*
 * key: publishable, write-only ingest, and inlined into `dist/` by design. It
 * lives in a gitignored `.env`; a `phx_` personal API key must never go near it.
 *
 * What we cannot make disappear, stated rather than glossed: the POST carries
 * an IP address, as every HTTP request does, and PostHog may derive coarse
 * location from it. See hackathon/DATA_AND_PRIVACY.md.
 */

/** The complete allowlist. Nothing outside this union can be captured. */
export type AppEvent =
  | 'page_view'
  | 'voice_session_started'
  ;

/**
 * Which of this app's two pages a row came from.
 *
 * An authored enum, never the raw query string. `?tdd=1` is a query parameter
 * rather than a route, so `location.pathname` is "/" on both pages and the two
 * were indistinguishable in the data. Reporting the whole search string would
 * have fixed that by opening a hole for arbitrary parameters; two words cannot.
 */
export type PageName = 'board' | 'resilience';

function pageName(): PageName {
  return new URLSearchParams(location.search).get('tdd') === '1' ? 'resilience' : 'board';
}

const ENDPOINT = 'https://us.i.posthog.com/i/v0/e';
const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

export const PRIVACY_URL = 'https://ideas.trustvalidated.com/privacy.html';

/**
 * Honour the browser's own signal before doing anything else. GPC is a legal
 * opt-out signal in several jurisdictions and costs three lines to respect.
 */
function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || navigator.doNotTrack === '1';
}

/** Random per page load, in memory, never written anywhere. */
const documentId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'no-uuid';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

/**
 * How someone arrived, which is the only question this instrumentation exists
 * to answer. Referrer is reduced to a host: knowing a visit came from
 * `news.ycombinator.com` answers it, and the full URL they were reading does
 * not need to be our business.
 */
function arrival(): Record<string, string> {
  const out: Record<string, string> = { path: location.pathname, page: pageName() };
  const params = new URLSearchParams(location.search);
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) out[key] = value.slice(0, 120);
  }
  if (document.referrer) {
    try {
      out.referrer_host = new URL(document.referrer).host;
    } catch {
      /* An unparseable referrer is simply not reported. */
    }
  }
  return out;
}

/**
 * The one piece of state this module keeps, and it exists only because an
 * opt-out you have to repeat on every page load is not an opt-out.
 *
 * `optedIn` writes nothing beyond the fact that the notice was answered, and
 * `optedOut` is the whole point of storing anything. Reading it is wrapped
 * because a browser with storage blocked must still render the page; a failure
 * to read is treated as "not answered", never as consent.
 */
const CHOICE_KEY = 'voice-application:analytics-choice';
export type AnalyticsChoice = 'optedIn' | 'optedOut' | null;

export function analyticsChoice(): AnalyticsChoice {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    return raw === 'optedIn' || raw === 'optedOut' ? raw : null;
  } catch {
    return null;
  }
}

export function setAnalyticsChoice(choice: Exclude<AnalyticsChoice, null>): void {
  try {
    localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Storage blocked. The choice still holds for this page, it just will not
    // be remembered, and the notice will ask again next time.
  }
  declined = choice === 'optedOut';
  announce();
}

/**
 * Forget the answer entirely, which puts the notice back.
 *
 * A notice you can only answer once is not consent, it is a click-through.
 * Withdrawing has to be at least as easy as agreeing was, so the footer carries
 * a control that reaches this and the stored word goes away with it.
 */
export function clearAnalyticsChoice(): void {
  try {
    localStorage.removeItem(CHOICE_KEY);
  } catch {
    /* Nothing to remove if storage was never writable. */
  }
  declined = false;
  announce();
}

/** Read once at module load, so `capture` stays a cheap synchronous call. */
let declined = analyticsChoice() === 'optedOut';

/**
 * Two surfaces show this setting: the notice bottom right and the control in
 * the footer. Without a subscription they each read the value once when they
 * mount, so forgetting your answer in the footer left the notice absent until a
 * reload, and the page disagreed with itself about what you had chosen.
 */
const listeners = new Set<() => void>();

export function subscribeToAnalyticsChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  for (const listener of listeners) listener();
}

export function capture(
  event: AppEvent,
  properties: Record<string, string | number | boolean> = {}
): void {
  if (!KEY || declined || optedOut()) return;
  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Survives the navigation when the event is an outbound click.
    keepalive: true,
    body: JSON.stringify({
      api_key: KEY,
      event,
      distinct_id: documentId,
      timestamp: new Date().toISOString(),
      properties: { ...arrival(), ...properties, $process_person_profile: false },
    }),
    // Analytics must never be able to break the page it measures.
  }).catch(() => {});
}
