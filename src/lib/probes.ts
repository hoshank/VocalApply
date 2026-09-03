/**
 * Three ways to drive the same widget. They differ in exactly one thing: how
 * they find what to act on.
 *
 * - `css`     locates by class and position, which is what a recorded test
 *             emits. Playwright codegen and Cypress Studio both write these.
 * - `testid`  locates by `data-testid`, which is the discipline both tools
 *             recommend, and it is genuinely good: it survives a restyle.
 * - `webmcp`  does not locate anything. It asks the page what it can do, and
 *             asks it to do it.
 *
 * The claim this page makes is narrow on purpose, and it is written down in
 * `EXPECTED` below rather than asserted in prose: a selector names an element,
 * a `data-testid` names an element the author promised to keep, and a tool
 * names an *action*. Only the last one survives a change to how the action is
 * laid out, because it never depended on the layout.
 *
 * What this is NOT: a benchmark, a speed claim, or an argument that WebMCP
 * replaces Playwright or Cypress. It fixes one failure mode. Nothing on this
 * page reports a number, because nothing here measured one.
 *
 * `tools/screenshots/verify-tdd.mjs` drives all sixteen cells of `EXPECTED` in
 * a real browser and fails if any of them stops being true. That verifier is
 * what keeps this page from becoming a claim nobody rechecks.
 */

import type { ModelContext, RegisteredTool } from '../webmcp/types';
import { getModelContext } from '../webmcp/polyfill';

export type ProbeId = 'css' | 'testid' | 'webmcp';

/**
 * The four states of the product this page pretends to ship. The names are the
 * change a team would actually put in a commit message.
 */
export type Variant = 'shipped' | 'cosmetic' | 'structural' | 'withdrawn';

export interface ShortlistValue {
  email: string;
  startDate: string;
  consent: boolean;
}

export interface ProbeResult {
  id: ProbeId;
  ok: boolean;
  /** Written the way a failing test reports itself, not the way a demo would. */
  detail: string;
}

/** What every probe tries to do. One target, so the three are comparable. */
export const TARGET: ShortlistValue = {
  email: 'rae@northwind.test',
  startDate: 'two-weeks',
  consent: true,
};

/**
 * The claim, as a table. A verifier reads this and drives the page against it.
 *
 * Read the `cosmetic` row before concluding anything: `data-testid` passes it.
 * A team that keeps testids is already immune to a restyle, and pretending
 * otherwise would be the easiest way to make this page dishonest.
 */
export const EXPECTED: Record<Variant, Record<ProbeId, boolean>> = {
  shipped: { css: true, testid: true, webmcp: true },
  cosmetic: { css: false, testid: true, webmcp: true },
  structural: { css: false, testid: false, webmcp: true },
  withdrawn: { css: false, testid: false, webmcp: false },
};

export interface ProbeContext {
  /** Clears the widget so a probe cannot pass on the previous probe's work. */
  reset: () => Promise<void>;
  /** Whatever the widget holds right now. */
  read: () => ShortlistValue;
  /** Lets React commit what the probe just did. */
  settle: () => Promise<void>;
}

/** A selector matched nothing. Reported separately from "acted, wrong result". */
class NotFound extends Error {
  constructor(selector: string) {
    super(`no element matches ${selector}`);
    this.name = 'NotFound';
  }
}

function must<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new NotFound(selector);
  return found;
}

/**
 * Sets a React-controlled field the way a real keystroke does: through the
 * native value setter, then an input event React is listening for. Assigning
 * `.value` directly is swallowed by React's synthetic event system, and a test
 * that did that would report a false pass.
 */
function typeInto(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Ticks a checkbox, or picks the affirmative option when the control is no
 * longer a checkbox. Both branches exist because the structural variant turns
 * one into the other, and a probe that only knew about checkboxes would report
 * the wrong reason for its failure.
 */
function affirm(el: HTMLInputElement | HTMLSelectElement): void {
  if (el instanceof HTMLSelectElement) {
    typeInto(el, 'yes');
    return;
  }
  if (!el.checked) el.click();
}

/**
 * `executeTool` both ways, because the spec and the shipping browser disagree
 * and the gap is closing from the spec's side.
 *
 * The IDL takes `optional object inputObject = {}` and the UA serializes it
 * (spec PR #246, merged 2026-08-17). Chrome 151 predates that and rejects an
 * object with `UnknownError: Failed to parse input arguments`, accepting only a
 * JSON string. WebIDL `object` rejects a String, so the string form starts
 * throwing the day the trial build catches up. Try the object, keep the string
 * as a dated fallback, and delete the fallback then. Checked 2026-09-01.
 */
async function executeTool(
  modelContext: ModelContext,
  tool: RegisteredTool,
  input: Record<string, unknown>
): Promise<string> {
  try {
    return await modelContext.executeTool(tool, input);
  } catch {
    return await modelContext.executeTool(tool, JSON.stringify(input));
  }
}

/** Did the widget end up holding what the probe was trying to put there? */
function verify(read: () => ShortlistValue): ProbeResult['detail'] | null {
  const got = read();
  const wrong = (Object.keys(TARGET) as (keyof ShortlistValue)[]).filter(
    (key) => got[key] !== TARGET[key]
  );
  if (wrong.length === 0) return null;
  return `found the controls but the form did not take the value: ${wrong.join(', ')}`;
}

type Act = () => void | Promise<void>;

async function run(id: ProbeId, context: ProbeContext, act: Act): Promise<ProbeResult> {
  await context.reset();
  try {
    await act();
    await context.settle();
    const mismatch = verify(context.read);
    return mismatch ? { id, ok: false, detail: mismatch } : { id, ok: true, detail: 'filled and verified' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id, ok: false, detail: message };
  }
}

/**
 * The selectors a recorder emits: a class off the styling system, and a
 * position in the tree. Nothing here is bad practice by the standards of the
 * tool that wrote it — it is what you get when a test is recorded rather than
 * hand-written against agreed hooks.
 */
function cssProbe(context: ProbeContext): Promise<ProbeResult> {
  return run('css', context, () => {
    typeInto(must<HTMLInputElement>('.shortlist-form .applicant-email'), TARGET.email);
    typeInto(must<HTMLSelectElement>('.shortlist-form .start-date'), TARGET.startDate);
    affirm(must<HTMLInputElement>('.shortlist-form .consent-box'));
  });
}

/**
 * The disciplined version. A `data-testid` is a contract the author maintains
 * for the test's benefit, and it does its job through a restyle. What it names
 * is still an element, so it goes down with the element.
 */
function testidProbe(context: ProbeContext): Promise<ProbeResult> {
  return run('testid', context, () => {
    typeInto(must<HTMLInputElement>('[data-testid="email"]'), TARGET.email);
    typeInto(must<HTMLSelectElement>('[data-testid="start-date"]'), TARGET.startDate);
    affirm(must<HTMLInputElement>('[data-testid="consent"]'));
  });
}

/**
 * Asks the page what it can do, then asks it to do it. There is no selector in
 * this function, which is the entire difference.
 *
 * It is not immune to anything. It fails in `withdrawn`, correctly: the page
 * stopped offering the action, so a test that shortlists a role *should* go
 * red. What it survives is a change to how the action is presented.
 */
function webmcpProbe(context: ProbeContext): Promise<ProbeResult> {
  return run('webmcp', context, async () => {
    const modelContext = getModelContext();
    if (!modelContext) {
      throw new Error(
        'no model context — not a secure context, or the polyfill did not install'
      );
    }
    const tools = await modelContext.getTools();
    const tool = tools.find((candidate) => candidate.name === 'shortlist_role');
    if (!tool) throw new Error('no tool named shortlist_role is registered');
    await executeTool(modelContext, tool, { ...TARGET });
  });
}

const PROBES: Record<ProbeId, (context: ProbeContext) => Promise<ProbeResult>> = {
  css: cssProbe,
  testid: testidProbe,
  webmcp: webmcpProbe,
};

export const PROBE_ORDER: ProbeId[] = ['css', 'testid', 'webmcp'];

/** One at a time and in order: they share a widget, so they cannot overlap. */
export async function runProbes(context: ProbeContext): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const id of PROBE_ORDER) {
    results.push(await PROBES[id](context));
  }
  return results;
}
