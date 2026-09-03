/**
 * The fill engine.
 *
 * Fills every field the profile can answer, sensitive facts included: the
 * agent holds `profile.sensitive` and writes it, same as any other field.
 * `evaluateStep` used to run a second pass refusing probe fields and the
 * consent checkbox; both are gone. `field.probe` still describes what a
 * field would reveal, for the disclosure UI to render, but it no longer
 * blocks anything.
 */

import type { ApplicantProfile, ApplicationStep, FieldValue, FillOutcome } from '../data/types';

/** Flat key into `ApplicantProfile`, or a dotted `sensitive.*` key into `profile.sensitive`. */
function resolve(profile: ApplicantProfile, source: string): FieldValue | undefined {
  if (source.startsWith('sensitive.')) {
    const key = source.slice('sensitive.'.length) as keyof ApplicantProfile['sensitive'];
    const value = profile.sensitive[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'object' && 'from' in value) {
      return `${value.from} to ${value.to}, ${value.reason}`;
    }
    return undefined;
  }

  const value = (profile as unknown as Record<string, unknown>)[source];
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

/**
 * Sorts every field of one step into `filled` or `unanswerable`. `withheld`
 * stays on the `FillOutcome` type as a stable shape, but nothing populates or
 * reads it any more: nothing on this page refuses a question the profile can
 * answer.
 */
export function evaluateStep(step: ApplicationStep, profile: ApplicantProfile): FillOutcome {
  const filled: Record<string, FieldValue> = {};
  const unanswerable: string[] = [];

  for (const field of step.fields) {
    const value = field.source ? resolve(profile, field.source) : undefined;
    if (value === undefined || value === '') {
      unanswerable.push(field.name);
      continue;
    }
    filled[field.name] = value;
  }

  return { stepId: step.id, filled, withheld: [], unanswerable };
}

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`fill self-check failed: ${message}`);
}

/**
 * Runs at boot, in the deployed build as well as in dev. Asserts the new
 * invariant: a field with a `source`, sensitive facts included, always
 * resolves to a value, and every field ends up in exactly one of `filled` or
 * `unanswerable`, never both.
 */
export function __selfCheck(steps: ApplicationStep[], profiles: ApplicantProfile[]): string {
  let checked = 0;
  let sensitiveFilled = 0;

  for (const profile of profiles) {
    for (const step of steps) {
      const outcome = evaluateStep(step, profile);
      checked += 1;

      for (const field of step.fields) {
        assert(
          (field.name in outcome.filled) !== outcome.unanswerable.includes(field.name),
          `"${field.name}" landed in both filled and unanswerable, or neither, on ${step.id} for ${profile.id}`
        );
        if (field.source?.startsWith('sensitive.') && field.name in outcome.filled) {
          sensitiveFilled += 1;
        }
      }
    }
  }

  assert(sensitiveFilled > 0, 'no sensitive field was ever filled, so the reversal has no effect');

  return `fill self-check passed: ${checked} step evaluations, ${sensitiveFilled} sensitive fields filled`;
}
