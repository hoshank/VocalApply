/**
 * The keyless walkthrough: the same tools, the same order, spoken by the
 * browser's own speech synthesiser instead of by a model.
 *
 * Why it exists: without an API key this page was a static form, which meant
 * the demo did not exist for anyone who had not already set up billing with
 * Google.
 *
 * What it is NOT, said plainly because a scripted agent that looks live is a
 * lie the UI has to keep telling: there is no model here, nothing is
 * understood, and it cannot answer a question. It is a rehearsed sequence of
 * tool calls with narration. `speechSynthesis` runs entirely in the browser, so
 * this mode opens no socket and sends nothing anywhere.
 *
 * The narration is **derived from what the tools actually returned**, not
 * written out here. If the corpus gains a seventh screening question, this
 * walkthrough fills it and says so without anyone editing this file.
 */

import type { FunctionResponsePayload, LiveFunctionCall } from './liveClient';

interface Beat {
  /** Spoken before the calls in this beat run. */
  say?: string;
  /**
   * Either fixed calls, or calls built from what the previous beat returned.
   * The second form exists so `open_role` opens a role the search actually
   * returned, rather than an id written down here that the corpus could rename.
   */
  calls?: LiveFunctionCall[] | ((previous: Record<string, unknown>[]) => LiveFunctionCall[]);
  /** Spoken after they return, built from what they returned. */
  react?: (responses: Record<string, unknown>[]) => string[];
}

interface RoleSummary {
  id?: string;
  title?: string;
  location?: string;
  reasons?: string[];
}

function rolesOf(response: Record<string, unknown>): RoleSummary[] {
  return Array.isArray(response.roles) ? (response.roles as RoleSummary[]) : [];
}

function filledField(response: Record<string, unknown>, field: string): string | undefined {
  const filled = response.filled;
  if (!filled || typeof filled !== 'object') return undefined;
  const value = (filled as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * A raise, derived from whatever the profile actually said the pay was, so the
 * currency follows the persona. This used to be the literal string
 * `EUR 79,000`, which survived a change of corpus and quietly paid two
 * rupee-denominated people in euros.
 */
function withRaise(current: string | undefined): string | undefined {
  if (!current) return undefined;
  const currency = current.match(/^[A-Z]{3}/)?.[0];
  const digits = current.replace(/[^\d]/g, '');
  if (!currency || digits.length === 0) return undefined;

  const raised = Math.round((Number(digits) * 1.08) / 1000) * 1000;
  const locale = currency === 'INR' ? 'en-IN' : 'en-GB';
  return `${currency} ${raised.toLocaleString(locale)}`;
}

function filledCount(response: Record<string, unknown>): number {
  const filled = response.filled;
  return filled && typeof filled === 'object' ? Object.keys(filled).length : 0;
}

function unansweredOf(response: Record<string, unknown>): string[] {
  return Array.isArray(response.unanswerable) ? (response.unanswerable as string[]) : [];
}

const WALKTHROUGH: Beat[] = [
  {
    say: 'Let me see what is open here, and which of them actually suit you.',
    calls: [{ name: 'find_matching_roles', args: { matchProfile: true } }],
    react: (responses) => {
      const roles = rolesOf(responses[0]);
      const top = roles[0];
      if (!top) return ['Nothing came back from the board, so there is nothing to apply to.'];
      const because = top.reasons?.[0];
      return [
        `${roles.length} roles match, and the board is now showing that search.`,
        `Top of the list is ${top.title}, in ${top.location}.`,
        because ? `${because}.` : 'The board gave no particular reason to rank it first.',
      ];
    },
  },
  {
    // The demo the board exists for: not interested in that one, move down the
    // shortlist. The card that gets ringed is the page's, not the narration's.
    say: 'Say that one is not for you. I will move down the list.',
    calls: [{ name: 'next_role' }],
    react: (responses) => {
      const role = responses[0]?.role as { title?: string; location?: string } | undefined;
      if (!role?.title) return ['That was the end of the shortlist.'];
      return [
        `Next is ${role.title}, in ${role.location}. Position ${responses[0].position} of ${responses[0].of}.`,
      ];
    },
  },
  {
    say: 'I will open that one and start its application.',
    calls: (previous) => {
      const role = previous[0]?.role as { id?: string } | undefined;
      return role?.id ? [{ name: 'open_role', args: { roleId: role.id } }] : [];
    },
    react: () => ['The form is open. I have not answered anything yet.'],
  },
  {
    say: 'Let me look at where this application stands before I touch anything.',
    calls: [{ name: 'get_application_state' }],
    react: () => ['Five steps, and nothing filled in yet. I will work through them in order.'],
  },
  {
    say: 'Starting with contact details.',
    calls: [
      { name: 'open_step', args: { stepId: 'contact' } },
      { name: 'fill_step', args: { stepId: 'contact' } },
    ],
    react: (responses) => [
      `That is ${filledCount(responses[1])} answers in, straight from the profile. Nothing was sent anywhere.`,
    ],
  },
  {
    say: 'Next, eligibility and timing.',
    calls: [
      { name: 'open_step', args: { stepId: 'eligibility' } },
      { name: 'fill_step', args: { stepId: 'eligibility' } },
    ],
    react: (responses) => {
      const unanswered = unansweredOf(responses[1]);
      const line = `Right to work, notice period and time zone are in.`;
      return unanswered.length > 0
        ? [
            `${line} I left ${unanswered.length} blank, because the profile does not answer it and I am not going to guess on your behalf.`,
          ]
        : [line];
    },
  },
  {
    say: 'Now your experience.',
    calls: [
      { name: 'open_step', args: { stepId: 'experience' } },
      { name: 'fill_step', args: { stepId: 'experience' } },
    ],
    react: (responses) => [
      `${filledCount(responses[1])} more, including the written answer, which is taken from what your profile already says you did rather than invented.`,
    ],
  },
  {
    say: 'Then the screening questions — the ones a lot of forms leave for a human to type by hand.',
    calls: [
      { name: 'open_step', args: { stepId: 'screening' } },
      { name: 'fill_step', args: { stepId: 'screening' } },
    ],
    react: (responses) => [
      `${filledCount(responses[1])} more, straight from the profile, including current pay and the rest.`,
    ],
  },
  {
    say: 'Say the applicant just got a raise. Let me fix that.',
    calls: (previous) => {
      // previous[1] is the screening fill_step, whose `filled` carries the
      // profile's own current salary.
      const raised = withRaise(filledField(previous[1] ?? {}, 'current_salary'));
      return raised
        ? [{ name: 'correct_field', args: { stepId: 'screening', field: 'current_salary', value: raised } }]
        : [];
    },
    react: () => [
      'Updated, and remembered on this device for this applicant. Next session opens with that number already in, no need to say it twice.',
    ],
  },
  {
    // The walkthrough cannot receive an answer, so it demonstrates the ask and
    // then says plainly what a live session would do next. Filling this in with
    // invented text would be the walkthrough pretending to have heard someone.
    say: 'One question your profile cannot answer. Let me point at it.',
    calls: [{ name: 'ask_for_field', args: { stepId: 'experience', field: 'motivation' } }],
    react: (responses) => {
      const label = typeof responses[0]?.label === 'string' ? responses[0].label : 'that question';
      return [
        `${label} It is highlighted on screen and waiting for you.`,
        'In a live session you would answer out loud here, and what you said would be typed straight in. This walkthrough has no microphone, so it stays empty.',
      ];
    },
  },
  {
    say: 'Last step. Let me get it ready for you.',
    calls: [{ name: 'prepare_submit' }],
    react: (responses) => {
      const submitted = responses[0]?.submitted;
      return [
        submitted === false
          ? 'Focus is on the submit button, and that is where I stop. There is no tool on this page that presses it, so read it back and send it yourself.'
          : 'Something is wrong: this page reported a submission, and nothing here is allowed to submit.',
      ];
    },
  },
];

export interface ScriptedWalkthroughOptions {
  /** Resolves when the line has been spoken, or immediately when narration is off. */
  speak: (text: string) => Promise<void>;
  /** The same dispatcher the live session uses, so the tool log is identical. */
  runCalls: (calls: LiveFunctionCall[]) => Promise<FunctionResponsePayload[]>;
  signal: AbortSignal;
}

export async function runScriptedWalkthrough({
  speak,
  runCalls,
  signal,
}: ScriptedWalkthroughOptions): Promise<void> {
  let previous: Record<string, unknown>[] = [];

  for (const beat of WALKTHROUGH) {
    if (signal.aborted) return;

    if (beat.say) {
      await speak(beat.say);
      if (signal.aborted) return;
    }

    if (!beat.calls) continue;
    const calls = typeof beat.calls === 'function' ? beat.calls(previous) : beat.calls;
    if (calls.length === 0) continue;

    const responses = await runCalls(calls);
    if (signal.aborted) return;

    const payloads = responses.map((entry) => entry.response ?? {});
    previous = payloads;

    for (const line of beat.react?.(payloads) ?? []) {
      if (signal.aborted) return;
      await speak(line);
    }
  }
}
