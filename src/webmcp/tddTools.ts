/**
 * The two tools the selector-resilience page registers. Same conventions as
 * `tools.ts`: `title` and both `annotations` on every tool, every time, the
 * second `execute` parameter read optionally and never destructured, and a
 * failure returned as a value rather than thrown.
 *
 * These are deliberately not added to `tools.ts`. That file is the application
 * form's registry and the voice session reads whatever is registered, so
 * leaving a `shortlist_role` tool in the main page's registry would put a tool
 * in front of the voice agent that has nothing to do with the application.
 * This page renders instead of that one, so the two registries never coexist.
 */

import type { JSONSchema, ModelContextTool, ToolExecuteCallbackOptions } from './types';
import type { ShortlistValue } from '../lib/probes';

export interface TddToolsInput {
  read: () => ShortlistValue;
  write: (next: Partial<ShortlistValue>) => void;
}

/**
 * Chrome 151 invokes `execute` with ONE argument, so the spec's second
 * parameter is `undefined` there. Destructuring `{ signal }` in the parameter
 * list throws before the body runs and takes out every tool on the page.
 */
function stopIfAborted(options: ToolExecuteCallbackOptions | undefined, what: string): void {
  if (options?.signal?.aborted) {
    throw new DOMException(`${what} was aborted before it finished.`, 'AbortError');
  }
}

const START_VALUES = ['immediately', 'two-weeks', 'one-month'];

const SHORTLIST_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    email: {
      type: 'string',
      description: 'Work email address to shortlist the role against.',
      format: 'email',
    },
    startDate: {
      type: 'string',
      description: 'How soon this person could start.',
      enum: START_VALUES,
    },
    consent: {
      type: 'boolean',
      description:
        'True only if the person has agreed their profile may be shared with the hiring team. Never assume it.',
    },
  },
  required: ['email', 'startDate', 'consent'],
};

export function buildTddTools({ read, write }: TddToolsInput): ModelContextTool[] {
  return [
    {
      name: 'read_shortlist',
      title: 'Read the shortlist form',
      description:
        'Read what the shortlist form currently holds: the email, the earliest start date, and whether sharing was agreed to.',
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (_input, options) => {
        stopIfAborted(options, 'read_shortlist');
        return { ok: true, ...read() };
      },
    },
    {
      name: 'shortlist_role',
      title: 'Shortlist this role',
      description:
        'Fill the shortlist form with an email, an earliest start date and whether the profile may be shared. Does not send anything: the person still presses the button.',
      inputSchema: SHORTLIST_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input, options) => {
        stopIfAborted(options, 'shortlist_role');

        const email = typeof input.email === 'string' ? input.email.trim() : '';
        const startDate = typeof input.startDate === 'string' ? input.startDate : '';
        const consent = input.consent === true;

        if (!email.includes('@')) {
          return { ok: false, error: 'email must be an address, for example rae@northwind.test' };
        }
        if (!START_VALUES.includes(startDate)) {
          return { ok: false, error: `startDate must be one of: ${START_VALUES.join(', ')}` };
        }

        // The whole reason this survives a redesign: it writes the value, not
        // an element. Nothing in here knows what the form looks like.
        write({ email, startDate, consent });
        return { ok: true, ...read(), note: 'Filled. Nothing was sent.' };
      },
    },
  ];
}
