/**
 * Every tool this page registers. The voice layer does not import this file and
 * does not know these names: it asks `document.modelContext.getTools()` at
 * session setup and maps whatever comes back. That indirection is the demo's
 * actual claim, so do not shortcut it by handing the declarations to the voice
 * client directly.
 *
 * Two rules, both load-bearing:
 *
 * 1. Every tool sets `title` and both `annotations`, every time. An unset
 *    `readOnlyHint` defaults to false, which is an assertion that the tool
 *    mutates: leaving it off is the wrong claim made silently.
 *
 * 2. **Nothing here submits.** Not one branch. `prepare_submit` moves focus and
 *    stops. A voice interface makes "just say yes to send it" the obvious next
 *    feature, and that feature is the one thing this demo exists to refuse.
 */

import type { JSONSchema, ModelContextTool, ToolExecuteCallbackOptions } from './types';
import { TOOL_COPY, type ToolName } from './toolCopy';
import type {
  ApplicantProfile,
  ApplicationStep,
  Employment,
  FieldValue,
  FillOutcome,
  JobPosting,
  WorkMode,
} from '../data/types';
import { formatSalary } from '../data/types';
import { matchOpenings, type RoleFilters } from '../lib/matchOpenings';

export interface VoiceSnapshot {
  /** Every opening on the board. The three board tools read this. */
  openings: JobPosting[];
  /** The opening whose application is open, which is what every other tool acts on. */
  posting: JobPosting;
  applicants: ApplicantProfile[];
  applicant: ApplicantProfile;
  currentStepId: string;
  values: Record<string, Record<string, FieldValue>>;
  outcomes: Record<string, FillOutcome>;
}

export interface ToolsInput {
  getState: () => VoiceSnapshot;
  fillStep: (stepId: string) => FillOutcome;
  /**
   * What `correct_field` writes, and the only tool-side writer of a single
   * field. It is deliberately not the same function the form's own inputs use:
   * a correction spoken out loud is the one answer that outlives the session,
   * while everything a bulk fill wrote is cleared when the session ends, so a
   * demo never opens on the last demo's form.
   */
  correctField: (stepId: string, field: string, value: FieldValue) => void;
  openStep: (stepId: string) => void;
  selectApplicant: (applicantId: string) => void;
  /** Moves focus to the submit button. Cannot press it; nothing here can. */
  focusSubmit: () => boolean;
  /** Opens one role and its application. False when the id is not on the board. */
  openRole: (roleId: string) => boolean;
  /** Marks the field the agent is waiting on, so the form can show which one. Null clears it. */
  setAwaiting: (target: { stepId: string; field: string } | null) => void;
  /**
   * Drives the board's own filter bar and shortlist cursor from a tool, so what
   * the agent describes and what the person sees are the same search.
   */
  showOnBoard: (view: { filters: RoleFilters; shortlist: string[] }) => void;
  /** Moves the cursor through the shortlist. Returns the role now under it. */
  stepShortlist: (delta: number) => { role: JobPosting; index: number; total: number } | null;
}

const SUBMISSION_NOTE =
  'No tool on this page submits the application, and no spoken instruction can. Fill the steps, read the answers back, then tell the person the submit button is theirs to press.';

function named(name: ToolName): { name: ToolName; title: string } {
  return { name, title: TOOL_COPY[name].title };
}

/**
 * Chrome 151 invokes `execute` with ONE argument, so the spec's second
 * parameter is `undefined` there. Destructuring `{ signal }` in the parameter
 * list throws a TypeError before the body runs and takes out every tool on the
 * page. Read the signal through here instead, never by destructuring.
 */
function stopIfAborted(options: ToolExecuteCallbackOptions | undefined, what: string): void {
  if (options?.signal?.aborted) {
    throw new DOMException(`${what} was aborted before it finished.`, 'AbortError');
  }
}

/**
 * Failures are a value, not a rejection. A rejected promise reaches a model as
 * a stack-shaped string it cannot act on; an object naming the valid ids is
 * something it can retry against, and something the voice can read out.
 */
function fail(error: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: false, error, ...extra };
}

function stepById(posting: JobPosting, stepId: string): ApplicationStep | undefined {
  return posting.steps.find((step) => step.id === stepId);
}

const STEP_ID_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    stepId: {
      type: 'string',
      description:
        'Id of the step, exactly as returned by list_application_steps. Not its title and not its position.',
    },
  },
  required: ['stepId'],
};

const FIND_ROLES_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    workMode: {
      type: 'string',
      enum: ['onsite', 'hybrid', 'remote'],
      description: 'Keep only roles with this work mode.',
    },
    employment: {
      type: 'string',
      enum: ['full-time', 'part-time', 'fixed-term'],
      description: 'Keep only roles on this kind of contract.',
    },
    location: {
      type: 'string',
      description:
        'Case-insensitive substring of the role location, for example "Netherlands", "Manchester" or "Remote".',
    },
    team: {
      type: 'string',
      description: 'Exact team name, as returned by list_open_roles. Not a substring.',
    },
    keywords: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Keep roles mentioning at least one of these in their title, team, location, summary or listed skills. Each further hit raises the ranking.',
    },
    minSalary: {
      type: 'number',
      description:
        'Keep roles whose band reaches at least this figure. Currencies are never converted, so pass currency alongside it.',
    },
    currency: {
      type: 'string',
      enum: ['EUR', 'GBP', 'INR'],
      description:
        'Only meaningful with minSalary. Bands are never converted, so a minSalary without a currency compares rupees against euros as plain numbers.',
    },
    matchProfile: {
      type: 'boolean',
      description:
        'Rank against the selected person. True by default. Ranking never removes a role, it only orders them.',
    },
    limit: { type: 'number', description: 'How many to return. Nine by default; matched reports the full count.' },
  },
};

const SYNTHETIC_NOTE =
  'Every role, salary and person in this demo is invented. Nothing here is a real vacancy.';

function roleCard(role: JobPosting) {
  return {
    id: role.id,
    title: role.title,
    team: role.team,
    location: role.location,
    workMode: role.workMode,
    employment: role.employment,
    salary: formatSalary(role),
    salaryFrom: role.salaryFrom,
    salaryTo: role.salaryTo,
    currency: role.currency,
    minYears: role.minYears,
    skills: role.skills,
    postedOn: role.postedOn,
    summary: role.summary,
  };
}

export function buildTools({
  getState,
  fillStep,
  correctField,
  openStep,
  selectApplicant,
  focusSubmit,
  openRole,
  setAwaiting,
  showOnBoard,
  stepShortlist,
}: ToolsInput): ModelContextTool[] {
  // The roster itself never changes at runtime, only who is selected — a
  // snapshot at registration time is fine, and lets switch_applicant's schema
  // enumerate the two known ids instead of taking an unconstrained string.
  const { applicants } = getState();

  return [
    {
      ...named('list_open_roles'),
      description:
        'List every opening on the board, in the order the page shows them, with team, location, work mode, contract, pay band and the skills each one asks for. Use find_matching_roles instead once you want a shortlist rather than the whole board.',
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_input, options) => {
        stopIfAborted(options, 'list_open_roles');
        const state = getState();
        return {
          ok: true,
          note: SYNTHETIC_NOTE,
          company: state.posting.company,
          count: state.openings.length,
          roles: state.openings.map(roleCard),
        };
      },
    },

    {
      ...named('find_matching_roles'),
      description:
        'Search the board, and show that search on screen: the filter bar is set to whatever you passed, the results narrow to match, and the top result is ringed so the person can see the one you are about to name. Returns the roles ranked with a reason for each. Filters are hard: workMode, employment, location, team, keywords, minSalary and currency each remove roles, and removedBy reports how many each one took out, so a search returning nothing can be widened rather than abandoned. Profile matching is soft: it ranks and never removes. Say the count, then read the first title and let them respond. Use next_role to move on, open_role to open one.',
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      inputSchema: FIND_ROLES_SCHEMA,
      execute: async (input, options) => {
        stopIfAborted(options, 'find_matching_roles');
        const state = getState();
        const raw = (input ?? {}) as Record<string, unknown>;

        const workMode = raw.workMode as WorkMode | undefined;
        if (workMode && !['onsite', 'hybrid', 'remote'].includes(workMode)) {
          return fail(`"${workMode}" is not a work mode.`, { workModes: ['onsite', 'hybrid', 'remote'] });
        }

        const employment = raw.employment as Employment | undefined;
        if (employment && !['full-time', 'part-time', 'fixed-term'].includes(employment)) {
          return fail(`"${employment}" is not a contract type.`, {
            employmentTypes: ['full-time', 'part-time', 'fixed-term'],
          });
        }

        const filters: RoleFilters = {
          workMode,
          employment,
          location: typeof raw.location === 'string' ? raw.location : undefined,
          team: typeof raw.team === 'string' ? raw.team : undefined,
          keywords: Array.isArray(raw.keywords)
            ? raw.keywords.filter((word): word is string => typeof word === 'string')
            : undefined,
          minSalary: typeof raw.minSalary === 'number' ? raw.minSalary : undefined,
          currency: typeof raw.currency === 'string' ? raw.currency : undefined,
          matchProfile: raw.matchProfile !== false,
          limit: typeof raw.limit === 'number' ? raw.limit : 9,
        };

        const result = matchOpenings(state.openings, state.applicant, filters);

        // Put the same search on screen. Without this the board still shows all
        // nine while the agent talks about two, and the person has no way to
        // check what it just told them.
        showOnBoard({ filters, shortlist: result.matches.map((match) => match.role.id) });

        return {
          ok: true,
          note: SYNTHETIC_NOTE,
          shownOnBoard: true,
          current: result.matches[0] ? roleCard(result.matches[0].role) : null,
          rankedAgainst: filters.matchProfile ? state.applicant.id : null,
          filters,
          searched: state.openings.length,
          matched: result.matched,
          returned: result.matches.length,
          removedBy: result.removedBy,
          notes: result.notes,
          roles: result.matches.map((match) => ({
            ...roleCard(match.role),
            score: match.score,
            reasons: match.reasons,
          })),
        };
      },
    },

    {
      ...named('open_role'),
      description:
        'Open one role and its application form, by the id from list_open_roles or find_matching_roles. Does not answer any field and cannot send anything. Call get_application_state afterwards, because the step list belongs to the role you just opened.',
      inputSchema: {
        type: 'object',
        properties: {
          roleId: {
            type: 'string',
            description: 'Id of the role, exactly as returned by the two search tools. Not its title.',
          },
        },
        required: ['roleId'],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input, options) => {
        stopIfAborted(options, 'open_role');
        const roleId = typeof input.roleId === 'string' ? input.roleId : '';
        const state = getState();

        if (!openRole(roleId)) {
          return fail(`There is no role with id "${roleId}".`, {
            roleIds: state.openings.map((role) => role.id),
          });
        }

        const opened = state.openings.find((role) => role.id === roleId);
        return {
          ok: true,
          note: SYNTHETIC_NOTE,
          role: opened ? roleCard(opened) : null,
          submissionNote: SUBMISSION_NOTE,
        };
      },
    },

    {
      ...named('next_role'),
      description:
        'Move to the next role in the shortlist find_matching_roles just produced, when the person is not interested in the one you read out. The board rings the new one and scrolls to it. Pass direction "previous" to go back. Returns the role now under the cursor, its position in the list, and whether you have run out. Read the title and let them respond; do not read the whole list at them.',
      inputSchema: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['next', 'previous'],
            description: 'Which way to move. Defaults to next.',
          },
        },
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, options) => {
        stopIfAborted(options, 'next_role');
        const direction = input?.direction === 'previous' ? -1 : 1;
        const moved = stepShortlist(direction);

        if (!moved) {
          return fail(
            'There is no shortlist to move through yet, or you have reached the end of it. Run find_matching_roles, or widen the search.',
            { atEnd: true }
          );
        }

        return {
          ok: true,
          note: SYNTHETIC_NOTE,
          position: moved.index + 1,
          of: moved.total,
          isLast: moved.index === moved.total - 1,
          role: roleCard(moved.role),
        };
      },
    },

    {
      ...named('get_application_state'),
      description:
        'Read the whole application in one call: the selected person, the step in view, and which fields hold values. Call this first, and again after anything that changes something.',
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_input, options) => {
        const state = getState();
        return {
          applicant: {
            id: state.applicant.id,
            name: state.applicant.name,
            headline: state.applicant.headline,
          },
          posting: {
            id: state.posting.id,
            title: state.posting.title,
            company: state.posting.company,
            location: state.posting.location,
            workMode: state.posting.workMode,
          },
          currentStepId: state.currentStepId,
          steps: state.posting.steps.map((step, index) => {
            stopIfAborted(options, 'get_application_state');
            const values = state.values[step.id] ?? {};
            const answered = step.fields.filter(
              (field) => values[field.name] !== undefined && values[field.name] !== ''
            );
            return {
              stepId: step.id,
              title: step.title,
              position: index + 1,
              isFinalStep: index === state.posting.steps.length - 1,
              fields: step.fields.length,
              answered: answered.length,
              filled: Object.fromEntries(answered.map((field) => [field.name, values[field.name]])),
            };
          }),
          submission: SUBMISSION_NOTE,
        };
      },
    },

    {
      ...named('list_application_steps'),
      description:
        'List the steps in order with their ids, what each asks for. Use the returned stepId with open_step, fill_step and correct_field.',
      // Static authored corpus (step titles/field names), never user-influenced: not the content this hint exists for.
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (_input, options) => {
        const state = getState();
        return {
          currentStepId: state.currentStepId,
          steps: state.posting.steps.map((step, index) => {
            stopIfAborted(options, 'list_application_steps');
            return {
              position: index + 1,
              stepId: step.id,
              title: step.title,
              blurb: step.blurb,
              fields: step.fields.map((field) => field.name),
              isFinalStep: index === state.posting.steps.length - 1,
            };
          }),
          submission: SUBMISSION_NOTE,
        };
      },
    },

    {
      ...named('get_applicant_profile'),
      description:
        'Read the selected person profile in full, sensitive facts included: date of birth, nationality, current salary, marital status, employment-gap detail and health information.',
      // Static authored persona data, never a prior correction: not the content this hint exists for.
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (_input, options) => {
        const { applicant } = getState();
        stopIfAborted(options, 'get_applicant_profile');
        return {
          id: applicant.id,
          name: applicant.name,
          headline: applicant.headline,
          location: applicant.location,
          timezone: applicant.timezone,
          yearsExperience: applicant.yearsExperience,
          email: applicant.email,
          phone: applicant.phone,
          skills: applicant.skills,
          currentEmployer: applicant.currentEmployer,
          currentTitle: applicant.currentTitle,
          achievement: applicant.achievement,
          workAuthorization: applicant.workAuthorization,
          noticePeriod: applicant.noticePeriod,
          portfolio: applicant.portfolio,
          dateOfBirth: applicant.sensitive.dateOfBirth,
          nationality: applicant.sensitive.nationality,
          currentSalary: applicant.sensitive.currentSalary,
          maritalStatus: applicant.sensitive.maritalStatus,
          careerBreak: applicant.sensitive.careerBreak,
          healthAccommodation: applicant.sensitive.healthAccommodation,
        };
      },
    },

    {
      ...named('open_step'),
      description:
        'Move the page to one step so the person can see what is being filled. Call it before fill_step, so nothing is typed into a screen nobody is looking at.',
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      inputSchema: STEP_ID_SCHEMA,
      execute: async (input) => {
        const state = getState();
        const stepId = String((input as Record<string, unknown>)?.stepId ?? '');
        const step = stepById(state.posting, stepId);
        if (!step) {
          return fail(`No step called "${stepId}".`, {
            stepIds: state.posting.steps.map((entry) => entry.id),
          });
        }
        openStep(step.id);
        return { ok: true, currentStepId: step.id, title: step.title, blurb: step.blurb };
      },
    },

    {
      ...named('fill_step'),
      description:
        'Fill one step from the selected profile, sensitive facts included. filled is an answer given; unanswerable is an answer the profile does not hold.',
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      inputSchema: STEP_ID_SCHEMA,
      execute: async (input, options) => {
        const state = getState();
        const stepId = String((input as Record<string, unknown>)?.stepId ?? '');
        const step = stepById(state.posting, stepId);
        if (!step) {
          return fail(`No step called "${stepId}".`, {
            stepIds: state.posting.steps.map((entry) => entry.id),
          });
        }

        stopIfAborted(options, 'fill_step');
        const outcome = fillStep(step.id);

        return {
          ok: true,
          stepId: step.id,
          title: step.title,
          humanSentence: step.humanSentence,
          filled: outcome.filled,
          unanswerable: outcome.unanswerable,
          note: 'Everything the profile can answer is filled in, including any sensitive facts it holds.',
          submission: SUBMISSION_NOTE,
        };
      },
    },

    {
      ...named('correct_field'),
      description:
        'Change exactly one answer, for when the person says something is wrong or has changed, sensitive facts included (e.g. current pay). The correction is remembered on this device for next time.',
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          stepId: { type: 'string', description: 'Id of the step holding the field.' },
          field: { type: 'string', description: 'The field name, as returned by list_application_steps.' },
          value: { type: 'string', description: 'The new answer, as the person said it.' },
        },
        required: ['stepId', 'field', 'value'],
      },
      execute: async (input) => {
        const state = getState();
        const raw = (input ?? {}) as Record<string, unknown>;
        const stepId = String(raw.stepId ?? '');
        const fieldName = String(raw.field ?? '');
        const value = String(raw.value ?? '');

        const step = stepById(state.posting, stepId);
        if (!step) {
          return fail(`No step called "${stepId}".`, {
            stepIds: state.posting.steps.map((entry) => entry.id),
          });
        }
        const field = step.fields.find((entry) => entry.name === fieldName);
        if (!field) {
          return fail(`No field called "${fieldName}" on step "${stepId}".`, {
            fields: step.fields.map((entry) => entry.name),
          });
        }
        // The accuracy declaration is not an answer, it is the person saying
        // they have read this. A tool that can write any field would otherwise
        // tick it for them, which is the same failure as submitting for them.
        if (field.kind === 'checkbox') {
          return fail(
            `"${field.name}" is a declaration, not an answer. Tell the person it is theirs to tick.`,
            { declaration: true }
          );
        }

        // No checkbox branch: the guard above returns before this, because the
        // only checkbox on this form is the declaration.
        const coerced: FieldValue = field.kind === 'number' ? Number(value) : value;
        if (field.kind === 'number' && !Number.isFinite(coerced as number)) {
          return fail(`"${value}" is not a number.`);
        }
        correctField(step.id, field.name, coerced);
        // Writing the answer ends the wait, whichever field was being asked about.
        setAwaiting(null);
        return { ok: true, stepId: step.id, field: field.name, value: coerced };
      },
    },

    {
      ...named('switch_applicant'),
      description:
        'Switch which fictional person is applying. Loads whatever this device remembers for that person; the next person answers differently.',
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          applicantId: {
            type: 'string',
            description: 'Id of the person, from get_application_state.',
            enum: applicants.map((entry) => entry.id),
          },
        },
        required: ['applicantId'],
      },
      execute: async (input) => {
        const state = getState();
        const applicantId = String((input as Record<string, unknown>)?.applicantId ?? '');
        const applicant = state.applicants.find((entry) => entry.id === applicantId);
        if (!applicant) {
          return fail(`No person called "${applicantId}".`, {
            applicantIds: state.applicants.map((entry) => entry.id),
          });
        }
        selectApplicant(applicant.id);
        return { ok: true, applicantId: applicant.id, name: applicant.name };
      },
    },

    {
      ...named('ask_for_field'),
      description:
        'Ask the person for one answer the profile does not hold. Opens the step, highlights that field on screen and marks it as waiting, so they can see which question you mean. Ask for one field at a time, then write what they say with correct_field, which clears the highlight. Returns the field label and whether it already has a value. Call with no field to clear a highlight without answering.',
      inputSchema: {
        type: 'object',
        properties: {
          stepId: { type: 'string', description: 'Id of the step holding the field.' },
          field: {
            type: 'string',
            description:
              'The field name, as returned by list_application_steps. Omit both to clear the current highlight.',
          },
        },
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input, options) => {
        stopIfAborted(options, 'ask_for_field');
        const state = getState();
        const raw = (input ?? {}) as Record<string, unknown>;
        const stepId = typeof raw.stepId === 'string' ? raw.stepId : '';
        const fieldName = typeof raw.field === 'string' ? raw.field : '';

        if (!stepId || !fieldName) {
          setAwaiting(null);
          return { ok: true, waiting: null, note: 'Cleared the highlight.' };
        }

        const step = stepById(state.posting, stepId);
        if (!step) {
          return fail(`No step called "${stepId}".`, {
            stepIds: state.posting.steps.map((entry) => entry.id),
          });
        }
        const field = step.fields.find((entry) => entry.name === fieldName);
        if (!field) {
          return fail(`No field called "${fieldName}" on step "${stepId}".`, {
            fields: step.fields.map((entry) => entry.name),
          });
        }
        if (field.kind === 'checkbox') {
          return fail(
            `"${field.name}" is a declaration for the person to tick, not a question to ask.`,
            { declaration: true }
          );
        }

        openStep(step.id);
        setAwaiting({ stepId: step.id, field: field.name });

        const current = state.values[step.id]?.[field.name];
        return {
          ok: true,
          waiting: { stepId: step.id, field: field.name },
          label: field.label,
          kind: field.kind,
          options: field.options ?? null,
          alreadyAnswered: current !== undefined && current !== '',
          currentValue: current ?? null,
          note: 'The field is highlighted on screen. Ask for it in your own words, then write the answer with correct_field.',
        };
      },
    },

    {
      ...named('prepare_submit'),
      description:
        'Move the page to the final step and put keyboard focus on the submit button. THIS DOES NOT SUBMIT, and nothing else on this page does either. After calling it, tell the person the application is ready and that pressing submit is theirs to do. If they say "submit it" or "go ahead", say plainly that you cannot, and why.',
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async () => {
        const state = getState();
        const finalStep = state.posting.steps[state.posting.steps.length - 1];
        openStep(finalStep.id);
        const focused = focusSubmit();
        return {
          ok: true,
          stepId: finalStep.id,
          submitFocused: focused,
          submitted: false,
          note: 'Focus is on the submit button. The press belongs to the person. There is no tool that presses it and adding one would be the bug this demo is about.',
        };
      },
    },
  ];
}

/**
 * Two registration scopes, one builder.
 *
 * The board and the application never register together. `registerTool` has no
 * upsert, and more to the point an agent offered `fill_step` while the person is
 * still browsing is being told about a form that is not on screen.
 *
 * `get_applicant_profile` and `switch_applicant` are in both sets deliberately:
 * choosing who you are is meaningful on either screen.
 */
const APPLICATION_ONLY = new Set<ToolName>([
  'get_application_state',
  'list_application_steps',
  'open_step',
  'fill_step',
  'correct_field',
  'ask_for_field',
  'prepare_submit',
]);

const BOARD_ONLY = new Set<ToolName>([
  'list_open_roles',
  'find_matching_roles',
  'open_role',
  'next_role',
]);

export function buildBoardTools(input: ToolsInput): ModelContextTool[] {
  return buildTools(input).filter((tool) => !APPLICATION_ONLY.has(tool.name as ToolName));
}

export function buildApplicationTools(input: ToolsInput): ModelContextTool[] {
  return buildTools(input).filter((tool) => !BOARD_ONLY.has(tool.name as ToolName));
}
