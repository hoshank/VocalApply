import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { applicants, openings, featuredOpening } from './data/corpus';
import type { FieldValue, FillOutcome, JobPosting } from './data/types';
import { formatSalary } from './data/types';
import { evaluateStep } from './lib/fill';
import type { RoleFilters } from './lib/matchOpenings';
import { buildApplicationTools, buildBoardTools, type VoiceSnapshot } from './webmcp/tools';
import { useWebMCP } from './webmcp/useWebMCP';
import { __toolsSelfCheck } from './webmcp/toolsSelfCheck';
import { ApplicationForm } from './components/ApplicationForm';
import { EMPTY_FILTERS, RoleBoard, type FilterState } from './components/RoleBoard';
import { SiteFooter, SiteHeader } from './components/SiteChrome';
import { PrivacyNotice } from './components/PrivacyNotice';
import { VoiceDock } from './components/VoiceDock';
import { TextAgentDock } from './components/TextAgentDock';
import { capture } from './lib/analytics';
import { useVoiceSession, type VoiceProvider } from './voice/useVoiceSession';
import { buildSystemInstruction } from './voice/systemInstruction';
import { buildTextSystemInstruction } from './voice/textSystemInstruction';

const KEY_STORAGE: Record<VoiceProvider, string> = {
  gemini: 'voice-application:gemini-key',
  openai: 'voice-application:openai-key',
};
const SAVED_VALUES_PREFIX = 'voice-application:saved-values:';

/**
 * Per-applicant memory. Keyed on the person rather than the role, because every
 * opening shares one application shape: an answer given once is still the right
 * answer on the next role.
 */
function loadSavedValues(applicantId: string): Record<string, Record<string, FieldValue>> {
  try {
    const raw = localStorage.getItem(SAVED_VALUES_PREFIX + applicantId);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * The key, in priority order: what the person typed this session, then
 * `VITE_GEMINI_API_KEY` / `VITE_OPENAI_API_KEY` from `.env`. The env fallback is
 * gated on `import.meta.env.DEV` on purpose. Vite inlines every `VITE_*` value at
 * build time, but the DEV branch is dead code in a build, so Rollup strips the
 * literal and a `dist/` physically cannot carry the key. Measured: with the
 * guard the value is absent from `dist/`; without it, it is present verbatim.
 */
function readStoredKey(provider: VoiceProvider): string {
  const fromEnv = import.meta.env.DEV
    ? ((provider === 'gemini' ? import.meta.env.VITE_GEMINI_API_KEY : import.meta.env.VITE_OPENAI_API_KEY) ?? '')
    : '';
  try {
    return sessionStorage.getItem(KEY_STORAGE[provider]) ?? fromEnv;
  } catch {
    // A tab with storage blocked still runs the demo, it just retypes the key.
    return fromEnv;
  }
}

export function App({ hasNativeWebMCP }: { hasNativeWebMCP: boolean }) {
  const [applicantId, setApplicantId] = useState(applicants[0].id);
  const [roleId, setRoleId] = useState(featuredOpening.id);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [values, setValues] = useState<Record<string, Record<string, FieldValue>>>(() =>
    loadSavedValues(applicants[0].id)
  );
  const [outcomes, setOutcomes] = useState<Record<string, FillOutcome>>({});
  const [currentStepId, setCurrentStepId] = useState(featuredOpening.steps[0].id);
  const [submitted, setSubmitted] = useState(false);
  const [justFilled, setJustFilled] = useState<Set<string>>(new Set());
  /** The one field the agent is waiting on, so the form can point at it. */
  const [awaiting, setAwaiting] = useState<{ stepId: string; field: string } | null>(null);
  /** The board's filter bar, up here because `find_matching_roles` sets it too. */
  const [boardFilters, setBoardFilters] = useState<FilterState>(EMPTY_FILTERS);
  /** The shortlist the agent is reading through, and where it has got to. */
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [apiKeys, setApiKeys] = useState<Record<VoiceProvider, string>>(() => ({
    gemini: readStoredKey('gemini'),
    openai: readStoredKey('openai'),
  }));
  const [dockTab, setDockTab] = useState<'voice' | 'text'>('voice');

  const submitRef = useRef<HTMLButtonElement>(null);
  const applicant = applicants.find((entry) => entry.id === applicantId) ?? applicants[0];
  const posting = openings.find((entry) => entry.id === roleId) ?? featuredOpening;

  // ---------------------------------------------------------------------
  // What the tools are given. One snapshot accessor rather than a dozen, so
  // every read tool sees a consistent view of the same moment.
  // ---------------------------------------------------------------------
  const stateRef = useRef<VoiceSnapshot>(null as unknown as VoiceSnapshot);
  stateRef.current = {
    openings,
    posting,
    applicants,
    applicant,
    currentStepId,
    values,
    outcomes,
  };

  const openStep = useCallback((stepId: string) => {
    setCurrentStepId(stepId);
    document.getElementById(`step-${stepId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const setFieldValue = useCallback((stepId: string, field: string, value: FieldValue) => {
    setValues((current) => ({ ...current, [stepId]: { ...(current[stepId] ?? {}), [field]: value } }));
    setJustFilled(new Set([`${stepId}.${field}`]));
    // Answering it yourself settles the question as well as saying it out loud.
    setAwaiting((current) =>
      current && current.stepId === stepId && current.field === field ? null : current
    );
  }, []);

  /** The only path from a tool to the form's values. */
  const fillStep = useCallback((stepId: string): FillOutcome => {
    const step = stateRef.current.posting.steps.find((entry) => entry.id === stepId);
    if (!step) throw new Error(`No step called "${stepId}".`);

    const profile = stateRef.current.applicant;
    const outcome = evaluateStep(step, profile);

    // Anything already sitting in this step (a remembered correction, most
    // often) wins over a fresh canonical fill, so a returning session does not
    // clobber what it just remembered.
    setValues((current) => ({ ...current, [stepId]: { ...outcome.filled, ...(current[stepId] ?? {}) } }));
    setOutcomes((current) => ({ ...current, [stepId]: outcome }));
    setAwaiting(null);
    setJustFilled(new Set(Object.keys(outcome.filled).map((field) => `${stepId}.${field}`)));
    return outcome;
  }, []);

  const selectApplicant = useCallback((id: string) => {
    setApplicantId(id);
    setValues(loadSavedValues(id));
    setOutcomes({});
    setAwaiting(null);
    setSubmitted(false);
    setJustFilled(new Set());
  }, []);

  /**
   * Opening a role is one function, and both the card and `open_role` call it.
   * A person and an agent taking different routes into the same screen is how
   * the two drift apart.
   */
  const openRole = useCallback((role: JobPosting) => {
    setRoleId(role.id);
    setApplicationOpen(true);
    setOutcomes({});
    setAwaiting(null);
    setSubmitted(false);
    setCurrentStepId(role.steps[0].id);
    window.scrollTo({ top: 0 });
    // Deliberately not captured. `AppEvent` is a closed allowlist and the
    // documented property set is path, UTM and referrer host only, so a role id
    // would breach both. See hackathon/DATA_AND_PRIVACY.md.
  }, []);

  const openRoleById = useCallback(
    (id: string) => {
      const next = openings.find((entry) => entry.id === id);
      if (!next) return false;
      openRole(next);
      return true;
    },
    [openRole]
  );

  /**
   * A tool ran a search, so the filter bar shows it. The two representations
   * differ on purpose: the tool speaks in typed filters, the bar in form
   * values, and this is the only place they are mapped.
   */
  const showOnBoard = useCallback(({ filters, shortlist: ids }: { filters: RoleFilters; shortlist: string[] }) => {
    setBoardFilters({
      search: (filters.keywords ?? []).join(' '),
      workMode: filters.workMode ?? '',
      employment: filters.employment ?? '',
      location: filters.location ?? '',
      minSalary: filters.minSalary === undefined ? '' : String(filters.minSalary),
      currency: filters.currency ?? '',
      rankByProfile: filters.matchProfile !== false,
    });
    setShortlist(ids);
    setCursor(0);
  }, []);

  const stepShortlist = useCallback(
    (delta: number) => {
      const next = cursor + delta;
      if (next < 0 || next >= shortlist.length) return null;
      const role = openings.find((entry) => entry.id === shortlist[next]);
      if (!role) return null;
      setCursor(next);
      return { role, index: next, total: shortlist.length };
    },
    [cursor, shortlist]
  );

  const currentRoleId = shortlist[cursor] ?? null;

  const backToBoard = useCallback(() => {
    setApplicationOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById('openings-heading')?.focus();
    });
  }, []);

  // Whatever this persona's form holds is what "next time" means: it survives a
  // reload or a switch away and back. Nothing here leaves the tab.
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_VALUES_PREFIX + applicantId, JSON.stringify(values));
    } catch {
      // Storage blocked. The session still works, it just will not remember.
    }
  }, [values, applicantId]);

  const focusSubmit = useCallback(() => {
    const button = submitRef.current;
    if (!button) return false;
    button.focus();
    button.classList.add('submit-armed');
    window.setTimeout(() => button.classList.remove('submit-armed'), 2000);
    return true;
  }, []);

  const toolsInput = useMemo(
    () => ({
      getState: () => stateRef.current,
      fillStep,
      setFieldValue,
      openStep,
      selectApplicant,
      focusSubmit,
      openRole: openRoleById,
      setAwaiting,
      showOnBoard,
      stepShortlist,
    }),
    [
      fillStep,
      setFieldValue,
      openStep,
      selectApplicant,
      focusSubmit,
      openRoleById,
      showOnBoard,
      stepShortlist,
    ]
  );

  /**
   * Two scopes, and they never overlap. Browsing the board, an agent is told
   * about the search; inside an application it is told about the form. Offering
   * `fill_step` while the person is still reading job adverts describes a screen
   * that is not there.
   */
  const tools = useMemo(
    () => (applicationOpen ? buildApplicationTools(toolsInput) : buildBoardTools(toolsInput)),
    [applicationOpen, toolsInput]
  );
  useWebMCP(tools);

  // After registration, once.
  useEffect(() => {
    __toolsSelfCheck()
      .then((line) => console.info(line))
      .catch((error) => {
        console.error(error);
        if (import.meta.env.DEV) throw error;
      });
  }, []);

  // ---------------------------------------------------------------------
  // The voice session. It reads the tools off `document.modelContext`, not
  // from `tools` above, which is why nothing is passed to it here.
  // ---------------------------------------------------------------------
  const voice = useVoiceSession({
    systemInstruction: () =>
      buildSystemInstruction({
        applicantName: stateRef.current.applicant.name,
        company: stateRef.current.posting.company,
        role: stateRef.current.posting.title,
        stepTitles: stateRef.current.posting.steps.map((step) => step.title),
      }),
  });

  const storeKey = (provider: VoiceProvider, value: string) => {
    setApiKeys((current) => ({ ...current, [provider]: value }));
    try {
      if (value) sessionStorage.setItem(KEY_STORAGE[provider], value);
      else sessionStorage.removeItem(KEY_STORAGE[provider]);
    } catch {
      // Storage blocked. The key still works for this session, in memory.
    }
  };

  const dock = (
    <div>
      <div
        role="tablist"
        aria-label="Agent input"
        className="mb-3 flex gap-1.5 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1"
      >
        {(['voice', 'text'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={dockTab === tab}
            onClick={() => setDockTab(tab)}
            className={`flex-1 rounded-[8px] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
              dockTab === tab
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunk)]'
            }`}
          >
            {tab === 'voice' ? 'Voice' : 'Type'}
          </button>
        ))}
      </div>

      {dockTab === 'voice' ? (
        <VoiceDock
          status={voice.status}
          mode={voice.mode}
          provider={voice.provider}
          error={voice.error}
          transcript={voice.transcript}
          toolLog={voice.toolLog}
          speaking={voice.speaking}
          level={voice.level}
          fullDuplex={voice.fullDuplex}
          muted={voice.muted}
          toolCount={voice.toolCount}
          apiKeys={apiKeys}
          onApiKeyChange={storeKey}
          onStart={(provider) => {
            capture('voice_session_started', { mode: 'live', provider });
            voice.start({ provider, apiKey: apiKeys[provider].trim() });
          }}
          onStartScripted={() => {
            capture('voice_session_started', { mode: 'scripted' });
            voice.startScripted();
          }}
          onStop={voice.stop}
          onSay={voice.say}
          onFullDuplexChange={voice.setFullDuplex}
          onMutedChange={voice.setMuted}
        />
      ) : (
        <TextAgentDock
          apiKey={apiKeys.gemini}
          toolCount={tools.length}
          systemInstruction={() =>
            buildTextSystemInstruction({
              applicantName: stateRef.current.applicant.name,
              company: stateRef.current.posting.company,
              role: stateRef.current.posting.title,
              stepTitles: stateRef.current.posting.steps.map((step) => step.title),
            })
          }
        />
      )}
    </div>
  );

  const applicantSwitcher = (
    <section
      aria-label="Choose the sample applicant"
      className="mt-10 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
    >
      <h2 className="text-[0.9375rem] font-semibold text-[var(--color-ink)]">Try it as</h2>
      <p className="mt-1 text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
        Two sample people, both invented. Whichever is selected is the profile the agent fills from.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {applicants.map((person) => {
          const selected = person.id === applicant.id;
          return (
            <button
              key={person.id}
              type="button"
              onClick={() => selectApplicant(person.id)}
              aria-pressed={selected}
              className={[
                'rounded-[10px] border p-4 text-left transition-colors',
                selected
                  ? 'border-[var(--color-accent-line)] bg-[var(--color-accent-soft)]'
                  : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)]',
              ].join(' ')}
            >
              <p className="text-[0.9375rem] font-medium text-[var(--color-ink)]">{person.name}</p>
              <p className="mt-0.5 text-[0.8125rem] text-[var(--color-ink-muted)]">{person.headline}</p>
            </button>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="min-h-dvh">
      <SiteHeader
        trailing={
          <span className="rounded-full border border-[var(--color-line-strong)] px-2.5 py-0.5 font-mono text-[0.625rem] tracking-[0.03em] text-[var(--color-ink-faint)]">
            {hasNativeWebMCP ? 'WebMCP native' : 'WebMCP polyfilled'}
          </span>
        }
      />

      <main>
        {applicationOpen ? (
          <div className="mx-auto max-w-[1240px] px-5 py-10 sm:px-8">
            <button
              type="button"
              onClick={backToBoard}
              className="flex items-center gap-1.5 text-[0.875rem] font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              <ArrowLeft size={15} weight="bold" aria-hidden />
              All open roles
            </button>

            <div className="mt-6 max-w-[62ch]">
              <p className="text-[0.875rem] text-[var(--color-ink-muted)]">{posting.team}</p>
              <h1 className="mt-1.5 text-[2rem] leading-[1.1] font-semibold tracking-[-0.025em] text-balance text-[var(--color-ink)]">
                {posting.title}
              </h1>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--color-ink-muted)]">
                {posting.summary}
              </p>
              <p className="mt-3 text-[0.875rem] text-[var(--color-ink-muted)]">
                {posting.location}. {formatSalary(posting)}.
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <ApplicationForm
                posting={posting}
                values={values}
                currentStepId={currentStepId}
                justFilled={justFilled}
                awaiting={awaiting}
                submitted={submitted}
                submitRef={submitRef}
                onChange={setFieldValue}
                onOpenStep={setCurrentStepId}
                onSubmit={() => setSubmitted(true)}
              />
              <div className="lg:sticky lg:top-[84px] lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-44">{dock}</div>
            </div>
          </div>
        ) : (
          <RoleBoard
            roles={openings}
            applicant={applicant}
            onOpenRole={openRole}
            aside={dock}
            filters={boardFilters}
            onFiltersChange={(next) => {
              setBoardFilters(next);
              // Touching the controls yourself ends the read-through: the list
              // the agent was walking is no longer the list on screen.
              setShortlist([]);
              setCursor(0);
            }}
            currentRoleId={currentRoleId}
          >
            {applicantSwitcher}
          </RoleBoard>
        )}
      </main>

      <SiteFooter />

      <PrivacyNotice />
    </div>
  );
}
