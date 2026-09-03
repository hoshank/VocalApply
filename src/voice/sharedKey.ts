/**
 * The shared-credential path, and the reason it is a relay rather than a key in
 * the bundle.
 *
 * This app has no backend, so anything it ships is readable: a key inlined into
 * `dist/` can be lifted with `curl | grep` by anyone who opens the page, and
 * scrapers watch public JavaScript for exactly that. `scripts/scan-dist-for-secrets.sh`
 * exists to fail the build when it happens.
 *
 * So the deployment keeps its keys on the server and exposes two routes that
 * mint a **short-lived token** from them (see the token relay block in
 * `deploy/Caddyfile.example`). The browser never sees a key. A token that does
 * leak is worth about a minute.
 *
 * Only the mint call goes through the box. Both providers then take the token
 * straight from the browser, so no audio crosses our server.
 *
 * **A key you type yourself never comes here.** It goes directly to the
 * provider, exactly as before, which is the private path and stays the honest
 * default for anyone who would rather not use ours.
 */

export type Provider = 'openai';

const RELAY: Record<Provider, string> = {
  openai: '/api/openai-token',
};

export class SharedKeyUnavailable extends Error {
  constructor(detail: string) {
    super(
      `The shared OpenAI credit is not available right now ` +
        `(${detail}). Paste your own key above to carry on.`
    );
    this.name = 'SharedKeyUnavailable';
  }
}

/**
 * Ask the relay for a token. Every failure is the same story to the person
 * reading it — no shared credit right now, use your own key — so they collapse
 * into one error rather than leaking whether the cause was a missing key on the
 * box, an exhausted quota, or a provider outage.
 */
async function mint(provider: Provider, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(RELAY[provider], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new SharedKeyUnavailable(error instanceof Error ? error.message : 'network error');
  }

  if (!response.ok) {
    throw new SharedKeyUnavailable(`relay returned ${response.status}`);
  }

  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new SharedKeyUnavailable('relay returned something that was not JSON');
  }
}

/**
 * An OpenAI Realtime ephemeral client secret.
 *
 * The same call the browser makes directly when you supply your own key, which
 * is why the body is passed in rather than built here: one shape, two routes to
 * it, and no chance of the shared path drifting from the private one.
 */
export async function mintOpenAIClientSecret(body: unknown): Promise<string> {
  const json = await mint('openai', body);
  const value = typeof json.value === 'string' ? json.value : undefined;
  if (!value) throw new SharedKeyUnavailable('no client secret in the response');
  return value;
}
