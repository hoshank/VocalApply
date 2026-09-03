/**
 * Human copy for every tool this page registers.
 *
 * Two registers, never the same sentence:
 *
 *   description  lives on the tool, is read by the model, is never rendered and
 *                is never spoken.
 *   human        lives here, is read by the person, is never sent to a model.
 *
 * Voice raises the stakes on that split. Rendering a model-facing `description`
 * in trusted product chrome launders whoever wrote it into the site's voice;
 * *speaking* it does the same thing in a voice the listener has started to
 * trust, with no visible quotation marks and no way to skim back. So the rule
 * here is stricter than the sibling project's: the agent is instructed to speak
 * from `title` and `humanSentence`, and the transcript renders only what was
 * actually said.
 */

export interface ToolCopy {
  /** Becomes `ModelContextTool.title`. Human, sentence case, no jargon. */
  title: string;
  /** What this does to YOUR data, addressed to the applicant. */
  human: string;
}

export type ToolName =
  | 'list_open_roles'
  | 'find_matching_roles'
  | 'open_role'
  | 'next_role'
  | 'get_application_state'
  | 'list_application_steps'
  | 'get_applicant_profile'
  | 'open_step'
  | 'fill_step'
  | 'correct_field'
  | 'switch_applicant'
  | 'ask_for_field'
  | 'prepare_submit';

export const TOOL_COPY: Record<ToolName, ToolCopy> = {
  list_open_roles: {
    title: 'List the open roles',
    human:
      'Reads the same nine openings the board shows you, in the same order, with pay and location as published.',
  },
  find_matching_roles: {
    title: 'Shortlist the roles that fit you',
    human:
      'Runs the search behind the filter bar. Filters can rule a role out and it says which one did; matching against your profile only changes the order, and never hides a job from you.',
  },
  next_role: {
    title: 'Move to the next role on the shortlist',
    human:
      'When you say you are not interested, the agent moves down the shortlist it just ran, rings the next card and reads that one out instead.',
  },
  open_role: {
    title: 'Open a role and start its application',
    human:
      'Opens one opening and its application form. It does not answer anything yet, and it cannot send anything at all.',
  },
  get_application_state: {
    title: 'Read where the application stands',
    human:
      'Lets the agent look at the same screen you are looking at, before it touches anything: which step you are on and which boxes have answers.',
  },
  list_application_steps: {
    title: 'List the steps in this application',
    human:
      'Asks the form how long it is, so the agent works through it in order instead of guessing at the shape of it.',
  },
  get_applicant_profile: {
    title: 'Read the full profile',
    human:
      'Hands over the whole profile: name, contact details, work history, skills, and the sensitive facts too — date of birth, nationality, current salary, marital status, any employment gap, and health information.',
  },
  open_step: {
    title: 'Move to a step',
    human: 'Scrolls the form to one step, so nothing is typed into a screen you are not looking at.',
  },
  fill_step: {
    title: 'Fill one step from the profile',
    human:
      'Types every answer the profile holds into one step, sensitive facts included. Nothing is sent anywhere.',
  },
  correct_field: {
    title: 'Fix a single answer',
    human:
      'Changes exactly one box, for when the agent misheard you or the answer has changed. The new value is remembered on this device for this applicant.',
  },
  switch_applicant: {
    title: 'Switch to the other sample person',
    human:
      'Changes which invented person is applying. This demo has no way to read your real profile, and does not want one.',
  },
  ask_for_field: {
    title: 'Ask you for one answer',
    human:
      'For the questions your profile cannot answer, the agent points at the field on screen and asks you out loud, one at a time. What you say is what gets typed in.',
  },
  prepare_submit: {
    title: 'Get the application ready for you to send',
    human:
      'Moves to the last step and puts the cursor on the submit button. It stops there. Nothing on this page can press it, including anything you say out loud.',
  },
};
