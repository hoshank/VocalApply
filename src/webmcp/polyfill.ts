/**
 * A WebMCP polyfill that follows the actual spec.
 *
 * Installs `document.modelContext` only when the browser has no native
 * implementation. Where the spec's behavior cannot be reproduced from script,
 * the gap is marked with `SPEC GAP:` rather than papered over.
 *
 * Reference: ref/official-origin-refs/webmcp/index.bs
 *            course-playlist/00-ground-truth.md
 */

import type {
  AgentSubmitEvent,
  JSONSchema,
  JSONSchemaProperty,
  ModelContext,
  ModelContextExecuteToolOptions,
  ModelContextGetToolOptions,
  ModelContextRegisterToolOptions,
  ModelContextTool,
  RegisteredTool,
} from './types';
import { DECLARATIVE_ATTRS } from './types';

/** Spec §Supporting concepts: 1-128 chars, ASCII alphanumeric plus `_`, `-`, `.` */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/** Marks a form as being filled by an agent. Native browsers give you `:tool-form-active`. */
const FORM_ACTIVE_CLASS = 'webmcp-tool-form-active';
const SUBMIT_ACTIVE_CLASS = 'webmcp-tool-submit-active';

interface RegistryEntry {
  tool: ModelContextTool;
  exposedTo: string[];
}

function domException(message: string, name: string): DOMException {
  return new DOMException(message, name);
}

// ---------------------------------------------------------------------------
// Declarative tool synthesis
// ---------------------------------------------------------------------------

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function numberOr(raw: string | null, fallback?: number): number | undefined {
  if (raw === null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reduce one form control to a JSON Schema property.
 *
 * SPEC GAP: the exact reduction from HTML constraint attributes (`min`, `max`,
 * `step`, `pattern`, `<option>`) down to JSON Schema is explicitly *not*
 * specified yet - the declarative explainer marks it TODO and says Chromium is
 * trialing "a loose version". What follows is a reasonable reading, not a
 * normative algorithm. Expect it to shift.
 */
function synthesizeProperty(el: FormControl): JSONSchemaProperty {
  const description = el.getAttribute(DECLARATIVE_ATTRS.paramDescription) ?? undefined;

  if (el.tagName === 'SELECT') {
    const select = el as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    if (select.multiple) {
      return { type: 'array', description, items: { type: 'string', enum: values } };
    }
    return { type: 'string', description, enum: values };
  }

  if (el.tagName === 'TEXTAREA') {
    const ta = el as HTMLTextAreaElement;
    return {
      type: 'string',
      description,
      minLength: numberOr(ta.getAttribute('minlength')),
      maxLength: numberOr(ta.getAttribute('maxlength')),
    };
  }

  const input = el as HTMLInputElement;

  switch (input.type) {
    case 'number':
    case 'range':
      return {
        type: 'number',
        description,
        minimum: numberOr(input.getAttribute('min')),
        maximum: numberOr(input.getAttribute('max')),
        multipleOf: numberOr(input.getAttribute('step')),
      };

    case 'checkbox':
      return { type: 'boolean', description };

    case 'email':
      return { type: 'string', description, format: 'email' };

    case 'url':
      return { type: 'string', description, format: 'uri' };

    case 'date':
      return { type: 'string', description, format: 'date' };

    case 'time':
      return { type: 'string', description, format: 'time' };

    case 'datetime-local':
      return { type: 'string', description, format: 'date-time' };

    case 'radio': {
      // All radios sharing a name collapse into one enum property.
      const group = input.form?.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${CSS.escape(input.name)}"]`
      );
      const values = group ? Array.from(group).map((r) => r.value) : [];
      return { type: 'string', description, enum: values };
    }

    default:
      return {
        type: 'string',
        description,
        minLength: numberOr(input.getAttribute('minlength')),
        maxLength: numberOr(input.getAttribute('maxlength')),
        pattern: input.getAttribute('pattern') ?? undefined,
      };
  }
}

/** Drop undefined-valued keys so the schema serializes cleanly. */
function prune<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

function synthesizeSchema(form: HTMLFormElement): JSONSchema {
  const properties: Record<string, JSONSchemaProperty> = {};
  const required: string[] = [];

  const controls = form.querySelectorAll<FormControl>(
    'input[name], select[name], textarea[name]'
  );

  for (const control of Array.from(controls)) {
    if (control instanceof HTMLInputElement) {
      // Submit-ish inputs are not parameters.
      if (['submit', 'reset', 'button', 'image', 'file'].includes(control.type)) continue;
      // Only the first radio of a group contributes a property.
      if (control.type === 'radio' && properties[control.name]) continue;
    }
    if (control.disabled) continue;

    properties[control.name] = prune(synthesizeProperty(control));
    if (control.required && !required.includes(control.name)) {
      required.push(control.name);
    }
  }

  const schema: JSONSchema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function setControlValue(form: HTMLFormElement, name: string, value: unknown): void {
  const controls = form.querySelectorAll<FormControl>(`[name="${CSS.escape(name)}"]`);
  if (controls.length === 0) return;

  for (const control of Array.from(controls)) {
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      control.checked = Boolean(value);
    } else if (control instanceof HTMLInputElement && control.type === 'radio') {
      control.checked = String(control.value) === String(value);
    } else {
      control.value = String(value);
    }
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * Build the execute steps for a declarative form tool.
 *
 * Two paths, and the difference between them is the whole point of the
 * declarative API:
 *
 *   `toolautosubmit` present -> fill and submit on the user's behalf.
 *   `toolautosubmit` absent  -> fill, focus the submit button, stop. The human
 *                               reviews and submits. No custom modal required;
 *                               this is the platform's own in-the-loop gate.
 */
function makeDeclarativeExecute(form: HTMLFormElement) {
  return async (input: Record<string, any>): Promise<any> => {
    const submitter = form.querySelector<HTMLElement>(
      'button[type="submit"], input[type="submit"], button:not([type])'
    );

    form.classList.add(FORM_ACTIVE_CLASS);
    submitter?.classList.add(SUBMIT_ACTIVE_CLASS);

    try {
      for (const [key, value] of Object.entries(input ?? {})) {
        setControlValue(form, key, value);
      }

      const autoSubmit = form.hasAttribute(DECLARATIVE_ATTRS.autoSubmit);
      const toolName = form.getAttribute(DECLARATIVE_ATTRS.name);

      if (!autoSubmit) {
        (submitter as HTMLElement | null)?.focus();
        return {
          filled: true,
          submitted: false,
          awaitingUserConfirmation: true,
          message:
            `Form "${toolName}" has been filled in. It has no toolautosubmit ` +
            `attribute, so the user must review and submit it themselves.`,
        };
      }

      // Capture-phase shim so the page's own submit handler sees the two
      // SubmitEvent additions the spec defines: `agentInvoked` and
      // `respondWith()`.
      let respondedWith: Promise<any> | undefined;
      const augment = (event: Event) => {
        const submitEvent = event as AgentSubmitEvent;
        Object.defineProperty(submitEvent, 'agentInvoked', {
          value: true,
          configurable: true,
        });
        submitEvent.respondWith = (response: Promise<any> | any) => {
          respondedWith = Promise.resolve(response);
        };
      };

      form.addEventListener('submit', augment, { capture: true, once: true });
      // requestSubmit() runs constraint validation first, which is what a real
      // agent-driven submission should do. form.submit() would skip it.
      form.requestSubmit(submitter as HTMLElement | undefined);
      form.removeEventListener('submit', augment, { capture: true });

      if (respondedWith) return await respondedWith;

      return { filled: true, submitted: true, message: `Submitted form tool "${toolName}".` };
    } finally {
      form.classList.remove(FORM_ACTIVE_CLASS);
      submitter?.classList.remove(SUBMIT_ACTIVE_CLASS);
    }
  };
}

function collectDeclarativeTools(doc: Document): ModelContextTool[] {
  const forms = doc.querySelectorAll<HTMLFormElement>(`form[${DECLARATIVE_ATTRS.name}]`);

  return Array.from(forms)
    .map((form): ModelContextTool | null => {
      const name = form.getAttribute(DECLARATIVE_ATTRS.name) ?? '';
      if (!TOOL_NAME_PATTERN.test(name)) return null;

      return {
        name,
        description:
          form.getAttribute(DECLARATIVE_ATTRS.description) ??
          'Fills in and submits a form on the page.',
        inputSchema: synthesizeSchema(form),
        execute: makeDeclarativeExecute(form),
      };
    })
    .filter((tool): tool is ModelContextTool => tool !== null);
}

// ---------------------------------------------------------------------------
// ModelContext
// ---------------------------------------------------------------------------

class PolyfilledModelContext extends EventTarget implements ModelContext {
  #registry = new Map<string, RegistryEntry>();
  #doc: Document;

  ontoolchange: ((this: ModelContext, ev: Event) => any) | null = null;

  constructor(doc: Document) {
    super();
    this.#doc = doc;

    // Mirror the `ontoolchange` IDL attribute onto the event target.
    this.addEventListener('toolchange', (event) => {
      this.ontoolchange?.call(this, event);
    });

    // Declarative tools appear and disappear with the DOM, so changes to
    // `toolname` / `tooldescription` must fire `toolchange` too.
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => this.#fireToolChange());
      observer.observe(doc.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          DECLARATIVE_ATTRS.name,
          DECLARATIVE_ATTRS.description,
          DECLARATIVE_ATTRS.autoSubmit,
        ],
      });
    }
  }

  #fireToolChange(): void {
    this.dispatchEvent(new Event('toolchange'));
  }

  async registerTool(
    tool: ModelContextTool,
    options: ModelContextRegisterToolOptions = {}
  ): Promise<void> {
    // Spec order: fully active, origin-keyed, permissions policy, then the
    // tool dictionary itself.
    if (!this.#doc.defaultView) {
      throw domException('Document is not fully active.', 'InvalidStateError');
    }

    // SPEC GAP: the spec rejects with SecurityError unless the agent cluster is
    // origin-keyed (or the scheme is `file:`), and gates on the `tools`
    // permissions-policy feature. Neither is observable from script, so a
    // polyfill cannot enforce them. It can enforce secure context, which the
    // `[SecureContext]` extended attribute on the interface requires.
    if (!window.isSecureContext && window.location.protocol !== 'file:') {
      throw domException(
        'ModelContext requires a secure context (HTTPS, localhost, or file:).',
        'SecurityError'
      );
    }

    if (this.#registry.has(tool.name)) {
      throw domException(
        `A tool named "${tool.name}" is already registered. There is no upsert; ` +
          `abort the previous registration's signal first.`,
        'InvalidStateError'
      );
    }

    if (!tool.name || !tool.description) {
      throw domException(
        'Both name and description are required and must be non-empty.',
        'InvalidStateError'
      );
    }

    if (!TOOL_NAME_PATTERN.test(tool.name)) {
      throw domException(
        `Invalid tool name "${tool.name}". Names must be 1-128 characters of ` +
          `ASCII alphanumerics, "_", "-", or ".".`,
        'InvalidStateError'
      );
    }

    if (typeof tool.execute !== 'function') {
      throw domException('Tool execute must be a function.', 'InvalidStateError');
    }

    if (tool.inputSchema !== undefined) {
      // The spec serializes the schema at registration time and propagates any
      // throw. Doing it here surfaces cyclic or non-serializable schemas early.
      JSON.stringify(tool.inputSchema);
    }

    if (options.signal?.aborted) return;

    this.#registry.set(tool.name, { tool, exposedTo: options.exposedTo ?? [] });

    options.signal?.addEventListener(
      'abort',
      () => {
        this.#registry.delete(tool.name);
        this.#fireToolChange();
      },
      { once: true }
    );

    this.#fireToolChange();
  }

  async getTools(options: ModelContextGetToolOptions = {}): Promise<RegisteredTool[]> {
    const view = this.#doc.defaultView;
    if (!view) return [];

    const origin = view.location.origin;
    const fromOrigins = options.fromOrigins ?? [];

    const imperative = Array.from(this.#registry.values())
      .filter(
        (entry) =>
          entry.exposedTo.length === 0 ||
          entry.exposedTo.includes(origin) ||
          entry.exposedTo.some((allowed) => fromOrigins.includes(allowed))
      )
      .map(({ tool }) => this.#toRegisteredTool(tool, view, origin));

    // Declarative tools are synthesized fresh on every call: the DOM is the
    // registry, so a form added a moment ago is discoverable immediately.
    const declarative = collectDeclarativeTools(this.#doc).map((tool) =>
      this.#toRegisteredTool(tool, view, origin)
    );

    const seen = new Set(imperative.map((t) => t.name));
    return [...imperative, ...declarative.filter((t) => !seen.has(t.name))];
  }

  #toRegisteredTool(tool: ModelContextTool, view: Window, origin: string): RegisteredTool {
    const registered: RegisteredTool = {
      name: tool.name,
      description: tool.description,
      window: view,
      origin,
    };
    if (tool.title !== undefined) registered.title = tool.title;
    if (tool.annotations !== undefined) registered.annotations = tool.annotations;
    // The spec hands out a deep copy so callers cannot mutate the registry.
    if (tool.inputSchema !== undefined) {
      registered.inputSchema = JSON.parse(JSON.stringify(tool.inputSchema));
    }
    return registered;
  }

  /**
   * Resolves to a **string**. The IDL is `Promise<DOMString>`, so whatever the
   * tool returns is serialized on the way out. Callers parse it themselves.
   */
  async executeTool(
    tool: RegisteredTool,
    input: string | Record<string, any> = {},
    options: ModelContextExecuteToolOptions = {}
  ): Promise<string> {
    const entry = this.#registry.get(tool.name);
    const target =
      entry?.tool ?? collectDeclarativeTools(this.#doc).find((t) => t.name === tool.name);

    if (!target) {
      throw domException(
        `No tool named "${tool.name}" is registered on this document.`,
        'NotFoundError'
      );
    }

    if (options.signal?.aborted) {
      throw domException('Tool execution was aborted before it started.', 'AbortError');
    }

    // Accept a JSON string as well as an object. The IDL says `object`, Chrome
    // 151 accepts only a string, so portable callers stringify. A polyfill that
    // takes both means the same call site works either side of the flag.
    let inputObject: Record<string, any>;
    if (typeof input === 'string') {
      try {
        inputObject = input.trim() === '' ? {} : JSON.parse(input);
      } catch {
        throw domException('Failed to parse input arguments', 'UnknownError');
      }
    } else {
      inputObject = input ?? {};
    }

    // The callback always receives a live signal, even when the caller passed
    // none: `ToolExecuteCallbackOptions.signal` is `required` in the IDL.
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const result = await target.execute(inputObject, { signal: controller.signal });
      return typeof result === 'string' ? result : JSON.stringify(result ?? null);
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort);
    }
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Duck-types `document.modelContext` before trusting it as native. Some
 * browser extensions and AI-browser shells inject a stub `modelContext` that
 * exposes only a couple of methods, not a real `EventTarget`. Backing off in
 * favour of that stub left `useVoiceSession`'s
 * `modelContext.addEventListener('toolchange', …)` calling a method the stub
 * never defined — `TypeError: … .addEventListener is not a function`.
 */
function looksLikeModelContext(value: unknown): value is ModelContext {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelContext>;
  return (
    typeof candidate.registerTool === 'function' &&
    typeof candidate.getTools === 'function' &&
    typeof candidate.executeTool === 'function' &&
    typeof (value as EventTarget).addEventListener === 'function'
  );
}

/** Whatever this page ended up with: the browser's, or ours. */
let active: ModelContext | null = null;

/**
 * The model context this page actually talks to.
 *
 * Not necessarily `document.modelContext`. A shell that installs its own
 * non-configurable `modelContext` on the document owns that property for the
 * life of the page, and this returns the working one instead. Every caller
 * reads through here; nothing reads the document directly.
 */
export function getModelContext(): ModelContext | undefined {
  return active ?? undefined;
}

/**
 * Installs the polyfill if and only if the browser lacks a native
 * implementation. Returns true when a native `document.modelContext` was found.
 */
export function setupWebMCPPolyfill(): boolean {
  if (typeof window === 'undefined') return false;

  const existing = 'modelContext' in document ? document.modelContext : undefined;
  if (looksLikeModelContext(existing)) {
    active = existing;
    return true;
  }

  const polyfill = new PolyfilledModelContext(document);
  active = polyfill;

  try {
    Object.defineProperty(document, 'modelContext', {
      value: polyfill,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  } catch {
    // An AI-browser shell — ChatGPT's is the one this was found on — can
    // install a *non-configurable* `document.modelContext` stub that fails the
    // duck-type above. `defineProperty` over it throws `TypeError: Cannot
    // redefine property: modelContext`, and this runs at module scope, so the
    // throw is a white page before React renders a single node. Chrome, which
    // either has no `modelContext` or has a real one, never reaches here.
    //
    // Assignment still lands if the stub left the property writable or gave it
    // a setter. If it did not, the document keeps theirs and `getModelContext`
    // is the only route to a working one.
    try {
      (document as { modelContext?: ModelContext }).modelContext = polyfill;
    } catch {
      /* frozen; `active` is still the polyfill */
    }

    if (document.modelContext !== polyfill) {
      console.warn(
        '[WebMCP] This browser owns document.modelContext and what it put ' +
          'there is not usable, so the polyfill runs beside it. Anything ' +
          'reading the document directly sees theirs, not ours.'
      );
    }
  }

  return false;
}

/** True when tools are backed by the browser rather than by this file. */
export function isNativeWebMCP(): boolean {
  return active !== null && !(active instanceof PolyfilledModelContext);
}
