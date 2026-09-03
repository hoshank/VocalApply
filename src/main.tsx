import '@fontsource-variable/outfit';
import '@fontsource-variable/jetbrains-mono';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setupWebMCPPolyfill } from './webmcp/polyfill';
import { __selfCheck as fillSelfCheck } from './lib/fill';
import { __selfCheck as boardSelfCheck } from './lib/matchOpenings';
import { __openaiSelfCheck as openaiSelfCheck } from './voice/openaiRealtimeClient';
import { applicants, openings } from './data/corpus';
import { capture } from './lib/analytics';
import { App } from './App';
import { TDDPage } from './components/TDDPage';

/**
 * Install before the first render. This ordering is load-bearing.
 *
 * React runs child effects before parent effects, so a polyfill installed in
 * any component's `useEffect` arrives *after* every descendant that wanted to
 * register a tool has already tried, logged, and given up. The page then has a
 * voice agent connected to an empty registry, and the failure is silent unless
 * you are watching the console. Module scope is the only place early enough.
 */
const hasNativeWebMCP = setupWebMCPPolyfill();

/**
 * The corpus checks itself before anything renders, in the deployed build as
 * well as in dev: a demo that says every field is fillable cannot ship a
 * sensitive field that quietly resolves to nothing. Thrown in dev, where the
 * person who broke it is watching; logged in a build, because a white screen
 * in front of an audience proves nothing to anyone.
 */
try {
  // Every opening, not just the featured one. They share a step builder, so a
  // bad `source` on one is a bad `source` on all nine, and checking one role
  // would still be checking the shape rather than the board.
  for (const role of openings) {
    fillSelfCheck(role.steps, applicants);
  }
  console.info(`fill self-check passed across ${openings.length} roles`);
  console.info(boardSelfCheck(openings, applicants));
  // The OpenAI Realtime session payload, asserted without a socket. Both
  // fields it checks failed silently until a real key was typed in: a missing
  // `session.type` produced a 400, and an unpinned input language produced a
  // working session that answered in the wrong one.
  console.info(openaiSelfCheck());
} catch (error) {
  console.error(error);
  if (import.meta.env.DEV) throw error;
}

/**
 * One anonymous page count. No cookie, nothing written to the device, no
 * identifier that outlives this page load. A no-op unless VITE_POSTHOG_KEY was
 * set at build time. See src/lib/analytics.ts.
 */
capture('page_view');

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing its #root element.');

/**
 * `?tdd=1` renders the selector-resilience page instead of the application.
 *
 * A query parameter rather than a route on purpose: a client-side path needs a
 * `try_files`-style fallback in every place this is served, and `deploy/` has
 * two of those. A parameter works unchanged on the deployed host, on `npm run
 * preview`, and over `file://`.
 *
 * The two pages never render together, which is why both can own a tool
 * registry without one page's tools showing up in front of the other's agent.
 */
const showTdd = new URLSearchParams(window.location.search).get('tdd') === '1';

createRoot(container).render(
  <StrictMode>
    {showTdd ? (
      <TDDPage hasNativeWebMCP={hasNativeWebMCP} />
    ) : (
      <App hasNativeWebMCP={hasNativeWebMCP} />
    )}
  </StrictMode>
);
