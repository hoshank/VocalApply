/**
 * WebMCP types, mirrored from the W3C CG draft.
 *
 * Source of truth for every claim here: course-playlist/00-ground-truth.md and
 * ref/official-origin-refs/webmcp/index.bs. Keep this file in sync with
 * hackathon/webmcp-starter-kit/src/core/types.ts; the two projects deliberately
 * carry their own copy rather than share a package, because this repo has no
 * workspace tooling.
 */

// ---------------------------------------------------------------------------
// JSON Schema (2020-12 subset). The spec references
// https://json-schema.org/draft/2020-12/ - not Draft 7.
// ---------------------------------------------------------------------------

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  items?: JSONSchemaProperty;
}

export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

// ---------------------------------------------------------------------------
// Spec dictionaries
// ---------------------------------------------------------------------------

/**
 * `dictionary ToolAnnotations`.
 *
 * `readOnlyHint` says the tool does not mutate state.
 * `untrustedContentHint` says the return value carries content the registering
 * author does not vouch for. It is the spec's designated mitigation for
 * output-injection: the client is expected to sanitize, spotlight, or hide it.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

/** `dictionary ToolExecuteCallbackOptions`. `signal` is required by the spec. */
export interface ToolExecuteCallbackOptions {
  signal: AbortSignal;
}

/**
 * `callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options)`
 *
 * The second parameter is optional here on purpose, and it disagrees with the
 * IDL on purpose. The IDL marks `options` required, and `signal` required
 * inside it. Chrome 151 under `--enable-features=WebMCP` calls `execute` with
 * exactly one argument. Measured, not read: see
 * course-playlist/00-ground-truth.md 10b.
 *
 * So this throws before your tool body runs:
 *
 *     execute: async (input, { signal }) => { ... }
 *     // TypeError: Cannot destructure property 'signal' of 'undefined'
 *
 * Never destructure it. Read it optionally:
 *
 *     execute: async (input, options) => {
 *       if (options?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
 *     }
 *
 * Typing it optional is what makes the compiler enforce that, instead of
 * letting `options.signal` through and failing at runtime in the one browser
 * that ships this API.
 */
export type ToolExecuteCallback = (
  input: Record<string, any>,
  options?: ToolExecuteCallbackOptions
) => Promise<any> | any;

/** `dictionary ModelContextTool` */
export interface ModelContextTool {
  /**
   * 1-128 characters, ASCII alphanumeric plus `_`, `-`, `.` only. The length
   * cap is a deliberate anti-prompt-injection measure, not an arbitrary limit.
   */
  name: string;
  /**
   * The human-facing label. This is the field the whole tool disclosure panel
   * in this app is built on, and the field the real WebMCP sites we surveyed
   * ship as an empty string. Never leave it blank here.
   */
  title?: string;
  /** The natural-language contract the model reads. Written for the model, never shown to users. */
  description: string;
  /** Optional. A tool with no parameters simply omits it. */
  inputSchema?: JSONSchema;
  execute: ToolExecuteCallback;
  annotations?: ToolAnnotations;
}

/** `dictionary ModelContextRegisterToolOptions` */
export interface ModelContextRegisterToolOptions {
  exposedTo?: string[];
  /**
   * Aborting this signal unregisters the tool. There is no `unregisterTool()`
   * in the spec: registration lifetime is owned by the signal.
   */
  signal?: AbortSignal;
}

/** `dictionary ModelContextGetToolOptions` */
export interface ModelContextGetToolOptions {
  fromOrigins?: string[];
}

/** `dictionary ModelContextExecuteToolOptions` */
export interface ModelContextExecuteToolOptions {
  signal?: AbortSignal;
}

/** `dictionary RegisteredTool` - what `getTools()` hands back. */
export interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JSONSchema;
  window: Window;
  origin: string;
  annotations?: ToolAnnotations;
}

/**
 * `interface ModelContext : EventTarget`
 *
 * All three methods return promises. `executeTool` resolves to a **string**
 * (`Promise<DOMString>` in the IDL), not an object.
 */
export interface ModelContext extends EventTarget {
  registerTool(
    tool: ModelContextTool,
    options?: ModelContextRegisterToolOptions
  ): Promise<void>;
  getTools(options?: ModelContextGetToolOptions): Promise<RegisteredTool[]>;
  /**
   * The IDL says `optional object inputObject = {}`. Chrome 151 rejects an
   * object with `UnknownError: Failed to parse input arguments` and accepts
   * only a JSON string. Both are typed here; pass input through `toolInput()`
   * from `src/lib/agentScript.ts` and the difference stops mattering.
   */
  executeTool(
    tool: RegisteredTool,
    input?: string | Record<string, any>,
    options?: ModelContextExecuteToolOptions
  ): Promise<string>;
  ontoolchange: ((this: ModelContext, ev: Event) => any) | null;
}

declare global {
  interface Document {
    modelContext: ModelContext;
  }
}

// ---------------------------------------------------------------------------
// Declarative WebMCP
//
// Real attribute names, confirmed against the spec's declarative explainer and
// the shipped Chrome Labs demos. Single words: `toolname`, never `tool-name`.
// ---------------------------------------------------------------------------

export const DECLARATIVE_ATTRS = {
  name: 'toolname',
  description: 'tooldescription',
  paramDescription: 'toolparamdescription',
  /**
   * Present: the agent submits after filling.
   * Absent: the browser focuses the submit button and the human submits.
   * That absence is this demo's central argument, so no form on the final
   * submit step may ever carry this attribute.
   */
  autoSubmit: 'toolautosubmit',
} as const;

/**
 * Additions to `SubmitEvent` for declarative tools. `agentInvoked` lets one
 * handler serve both humans and agents; `respondWith()` returns a value to the
 * agent without navigating, and requires `preventDefault()` first.
 */
export interface AgentSubmitEvent extends SubmitEvent {
  agentInvoked?: boolean;
  respondWith?: (response: Promise<any> | any) => void;
}

/**
 * Lowercase declarative attributes are not in React's JSX typings. Spreading
 * this onto a JSX element keeps them literal and keeps strict mode happy.
 */
export function declarativeFormAttrs(opts: {
  toolname: string;
  tooldescription: string;
  toolautosubmit?: boolean;
}): Record<string, string> {
  const attrs: Record<string, string> = {
    [DECLARATIVE_ATTRS.name]: opts.toolname,
    [DECLARATIVE_ATTRS.description]: opts.tooldescription,
  };
  if (opts.toolautosubmit) attrs[DECLARATIVE_ATTRS.autoSubmit] = '';
  return attrs;
}

/** Same trick for a form control's parameter description. */
export function declarativeParamAttrs(description: string): Record<string, string> {
  return { [DECLARATIVE_ATTRS.paramDescription]: description };
}
