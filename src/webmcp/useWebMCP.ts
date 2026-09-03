import { useEffect, useRef } from 'react';
import type { ModelContextTool } from './types';

/**
 * Registers WebMCP tools for the lifetime of a component.
 *
 * Three things this has to get right, and the naive version gets all three
 * wrong:
 *
 * 1. **Unregistration.** The spec has no `unregisterTool()`. A registration's
 *    lifetime is owned by the `AbortSignal` passed to `registerTool()`, so
 *    cleanup is `controller.abort()`.
 *
 * 2. **Registration churn.** Callers pass an array literal, which is a new
 *    identity every render. Keying the effect on the array itself would
 *    unregister and re-register every tool on every keystroke, which in this
 *    app means on every character the applicant types. We key on the tools'
 *    contract instead.
 *
 * 3. **Stale closures.** `execute` callbacks close over component state. If we
 *    register once and never re-register, those closures freeze at their
 *    first-render values. We register a trampoline that dispatches to the
 *    latest callback through a ref.
 *
 * The polyfill must already be installed when this runs. React runs child
 * effects before parent effects, so installing it in an ancestor's `useEffect`
 * is too late. `main.tsx` installs it before the first render.
 */
export function useWebMCP(tools: ModelContextTool | ModelContextTool[]): void {
  const list = Array.isArray(tools) ? tools : [tools];

  const latest = useRef<ModelContextTool[]>(list);
  latest.current = list;

  const signature = JSON.stringify(
    list.map((tool) => [
      tool.name,
      tool.title,
      tool.description,
      tool.inputSchema,
      tool.annotations,
    ])
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!document.modelContext) {
      console.error(
        `[WebMCP] document.modelContext is missing, so ${latest.current
          .map((t) => t.name)
          .join(', ')} did not register. Install the polyfill before the first ` +
          `render (see src/main.tsx), or check that this is a secure context.`
      );
      return;
    }

    const controller = new AbortController();

    for (const spec of latest.current) {
      const registration: ModelContextTool = {
        name: spec.name,
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: spec.annotations,
        execute(input, options) {
          const current = latest.current.find((t) => t.name === spec.name) ?? spec;
          return current.execute(input, options);
        },
      };

      document.modelContext
        .registerTool(registration, { signal: controller.signal })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error(`[WebMCP] Failed to register "${spec.name}":`, error);
        });
    }

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
