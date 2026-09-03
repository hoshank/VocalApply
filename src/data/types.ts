/**
 * The data contract for the voice demo.
 *
 * A smaller corpus than the sibling `agentic-job-application`: one employer,
 * nine openings, five steps, two people. It is one employer rather than ten
 * because this demo argues about a *modality* and the board exists to give the
 * voice something to search, not to be a market.
 *
 * The one idea kept whole from the sibling project, because the demo collapses
 * without it: a profile **knows** its sensitive facts. The agent could answer
 * the screening questions perfectly well. It declines to, out loud. A voice
 * agent that merely lacked the data would prove nothing about restraint.
 */

export interface SensitiveFacts {
  dateOfBirth: string;
  nationality: string;
  currentSalary: string;
  maritalStatus: string;
  careerBreak?: { from: string; to: string; reason: string };
  healthAccommodation?: string;
}

export interface ApplicantProfile {
  id: string;
  name: string;
  headline: string;
  location: string;
  timezone: string;
  yearsExperience: number;
  email: string;
  phone: string;
  skills: string[];
  currentEmployer: string;
  currentTitle: string;
  /** What they actually did there. Answers the one open question. */
  achievement: string;
  workAuthorization: string;
  noticePeriod: string;
  portfolio: string;
  sensitive: SensitiveFacts;
  /** Why this persona is here. Shown in the switcher, never sent to the form. */
  demoNote: string;
}

export type FieldKind = 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';

/**
 * A question that asks for something it should not.
 *
 * `reveals` is the characteristic an answer would expose, and it is the word the
 * agent says out loud. "I left date of birth blank" is far less useful to hear
 * than "that one reveals your age".
 */
export interface PrivacyProbe {
  reveals: string;
  /** Plain language, addressed to the applicant. Written to be spoken. */
  rationale: string;
  /** What a fair version of the question looks like. */
  fairAlternative: string;
  severity: 'withhold' | 'caution';
}

export interface ApplicationField {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
  /**
   * Model-facing. Never rendered, and never spoken: a parameter description is
   * an injection surface, and a voice agent reading one aloud launders whoever
   * wrote it into the site's own speaking voice, which is worse than rendering
   * it on screen.
   */
  agentDescription: string;
  /** Key into the profile. Absent means the profile was never going to know. */
  source?: keyof ApplicantProfile | 'sensitive.dateOfBirth' | 'sensitive.nationality' | 'sensitive.currentSalary' | 'sensitive.maritalStatus' | 'sensitive.careerBreak' | 'sensitive.healthAccommodation';
  /** Set when answering would hand over something an employer should not have. */
  probe?: PrivacyProbe;
}

export interface ApplicationStep {
  id: string;
  title: string;
  blurb: string;
  /** Our copy, spoken and shown. What this step does to *your* data. */
  humanSentence: string;
  fields: ApplicationField[];
}

export type WorkMode = 'onsite' | 'hybrid' | 'remote';
export type Employment = 'full-time' | 'part-time' | 'fixed-term';

/**
 * One opening on the board.
 *
 * Pay is two integers and a currency rather than the display string it used to
 * be, because the board and `find_matching_roles` both filter on it and a
 * filter cannot read "EUR 68,000 to 84,000". `formatSalary` is the only place
 * that turns it back into a sentence, so the number a person reads and the
 * number a tool filtered on cannot drift apart.
 */
export interface JobPosting {
  id: string;
  company: string;
  title: string;
  team: string;
  location: string;
  /** Used by the right-to-work question, which names a country. */
  country: string;
  workMode: WorkMode;
  employment: Employment;
  salaryFrom: number;
  salaryTo: number;
  currency: 'EUR' | 'GBP' | 'INR';
  /** Years of relevant experience the role asks for. Ranking reads it; nothing hides a role because of it. */
  minYears: number;
  skills: string[];
  /** Three lines, shown on the expanded card. What the job actually is. */
  responsibilities: string[];
  /** ISO date. The board sorts on it and shows it as "posted N days ago". */
  postedOn: string;
  summary: string;
  steps: ApplicationStep[];
}

export function formatSalary(role: Pick<JobPosting, 'salaryFrom' | 'salaryTo' | 'currency'>): string {
  // Indian grouping for rupees, because 42,00,000 is what the number looks like
  // to the people the Bengaluru roles are addressed to, and 4,200,000 is not.
  const locale = role.currency === 'INR' ? 'en-IN' : 'en-GB';
  const money = (value: number) => value.toLocaleString(locale);
  return `${role.currency} ${money(role.salaryFrom)} to ${money(role.salaryTo)}`;
}

export type FieldValue = string | number | boolean;

export interface WithheldField {
  field: string;
  label: string;
  probe: PrivacyProbe;
}

/** What one step's fill attempt actually did. Three destinations, never blurred. */
export interface FillOutcome {
  stepId: string;
  filled: Record<string, FieldValue>;
  withheld: WithheldField[];
  /** Fields the profile has no answer for. Different from withheld, always. */
  unanswerable: string[];
}
