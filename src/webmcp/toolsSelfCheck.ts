/**
 * The tool layer checks itself once, after registration, in the deployed build
 * as well as in dev.
 *
 * Why this exists as a runtime check rather than a test file: the thing worth
 * asserting is not that `buildTools` returns objects, it is that the *page*
 * ends up with a registry a voice agent can use — every tool titled and every
 * annotation set. That only exists after `useWebMCP` has run against a real
 * `document.modelContext`, which is a browser, not a unit test.
 *
 * Every assertion here is free of side effects. Nothing it calls writes a
 * value, moves focus or scrolls, or executes a tool at all — `correct_field`
 * now genuinely writes whatever it is asked to, so exercising it here would
 * mutate the visible form on every boot.
 */

import type { RegisteredTool } from './types';
import { getModelContext } from './polyfill';
import { TOOL_COPY, type ToolName } from './toolCopy';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`tools self-check failed: ${message}`);
}

/** The spec's rule: 1-128 chars, ASCII alphanumerics plus `_`, `-`, `.` only. */
const NAME_RULE = /^[A-Za-z0-9_.-]{1,128}$/;

export async function __toolsSelfCheck(): Promise<string> {
  const modelContext = getModelContext();
  assert(modelContext !== undefined, 'no model context, so nothing registered');

  const tools = (await modelContext!.getTools()) as RegisteredTool[];
  const names = tools.map((tool) => tool.name);

  // Registration is scoped: browsing the board and filling an application are
  // two different tool sets, and they never overlap. So the assertion is not
  // "every name is registered" any more, it is that whatever *is* registered is
  // exactly one of the two legal scopes. A half-registered page, or a board
  // that leaked `fill_step`, fails here.
  const BOARD_SCOPE: ToolName[] = [
    'list_open_roles',
    'find_matching_roles',
    'open_role',
    'next_role',
    'get_applicant_profile',
    'switch_applicant',
  ];
  const APPLICATION_SCOPE: ToolName[] = [
    'get_application_state',
    'list_application_steps',
    'get_applicant_profile',
    'open_step',
    'fill_step',
    'correct_field',
    'ask_for_field',
    'switch_applicant',
    'prepare_submit',
  ];

  const sorted = [...names].sort().join(',');
  const scope =
    sorted === [...BOARD_SCOPE].sort().join(',')
      ? 'board'
      : sorted === [...APPLICATION_SCOPE].sort().join(',')
        ? 'application'
        : null;

  assert(scope !== null, `the registry is neither scope. Registered: ${sorted || '(nothing)'}`);
  assert(
    scope !== 'board' || !names.includes('fill_step'),
    'the board scope leaked fill_step, which describes a form that is not on screen'
  );

  // Every name that carries human copy must live in one of the two scopes, or
  // the copy is dead and the disclosure panel describes nothing.
  for (const name of Object.keys(TOOL_COPY) as ToolName[]) {
    assert(
      BOARD_SCOPE.includes(name) || APPLICATION_SCOPE.includes(name),
      `"${name}" has copy but is in neither registration scope`
    );
  }

  assert(new Set(names).size === names.length, 'two tools registered under the same name');

  for (const tool of tools) {
    assert(NAME_RULE.test(tool.name), `"${tool.name}" breaks the spec charset rule`);
    assert(
      Boolean(tool.title && tool.title.trim()),
      `"${tool.name}" registered with a blank title, which leaves the UI showing a snake_case name`
    );
    assert(
      Boolean(tool.description && tool.description.trim()),
      `"${tool.name}" registered with no description`
    );
    assert(
      tool.annotations?.readOnlyHint !== undefined,
      `"${tool.name}" leaves readOnlyHint unset, which asserts that it mutates`
    );
    assert(
      tool.annotations?.untrustedContentHint !== undefined,
      `"${tool.name}" leaves untrustedContentHint unset`
    );
    assert(
      !/\bsubmit\b/i.test(tool.name) || tool.name === 'prepare_submit',
      `"${tool.name}" looks like it submits, and nothing here may`
    );
  }

  // `prepare_submit` is the only tool allowed anywhere near the button, and it
  // moves focus rather than pressing it.
  assert(
    tools.filter((tool) => /submit/i.test(tool.name)).length <= 1,
    'more than one tool has submit in its name'
  );

  return `tools self-check passed: ${tools.length} tools registered in the ${scope} scope`;
}
