/**
 * The typed counterpart to the live voice session: same tools, same
 * `document.modelContext.getTools()` / `executeTool()` dispatch, driven by
 * Gemini's plain `generateContent` REST endpoint instead of a live socket or a
 * WebRTC connection. No audio anywhere in this file.
 *
 * This is what makes "an external agent can drive this page without voice"
 * concrete rather than a claim: the same registered tools, exercised by typing
 * instead of talking, with the request/response shapes (role: 'user' carrying
 * `functionResponse` parts on the way back, not role: 'function') mirrored
 * from the sibling job-application demo's already-working `geminiAgent.ts`
 * rather than re-derived from memory.
 *
 * One turn in, one turn out: `runTextTurn` takes one typed message, mutates
 * the shared `history` array in place (so the caller owns conversation state
 * across turns, the way a chat UI expects), and resolves once the model has
 * either produced a final reply or exhausted `maxIterations` mid tool-call.
 */

import type { RegisteredTool } from '../webmcp/types';
import { toGeminiSchema } from '../voice/liveClient';

export const TEXT_AGENT_MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.1-flash-lite';
export const TEXT_AGENT_THINKING_LEVEL = import.meta.env.VITE_GEMINI_THINKING_LEVEL || 'high';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role?: string;
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  error?: { message?: string };
}

export type TextAgentEvent =
  | { type: 'tool-call'; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; name: string; ok: boolean; summary: string }
  | { type: 'message'; text: string }
  | { type: 'error'; message: string };

export interface RunTextTurnOptions {
  apiKey: string;
  model?: string;
  systemInstruction: string;
  /** Owned by the caller. Appended to in place across the whole turn. */
  history: GeminiContent[];
  signal: AbortSignal;
  onEvent: (event: TextAgentEvent) => void;
  /** Hard cap on tool-call rounds within this one turn. */
  maxIterations?: number;
}

function toFunctionDeclarations(tools: RegisteredTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    ...(tool.inputSchema ? { parameters: toGeminiSchema(tool.inputSchema) } : {}),
  }));
}

/** One line, ours, describing what a tool result contained. Never the raw payload. */
function summarize(parsed: unknown): { ok: boolean; summary: string } {
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (record.ok === false) {
      return { ok: false, summary: String(record.error ?? 'The tool refused the call.') };
    }
    if (record.filled && typeof record.filled === 'object') {
      return { ok: true, summary: `${Object.keys(record.filled as object).length} field(s) filled` };
    }
    if (record.submitted === false) {
      return { ok: true, summary: 'focus moved to submit; nothing was sent' };
    }
  }
  return { ok: true, summary: 'returned' };
}

async function callGemini(
  options: RunTextTurnOptions,
  body: Record<string, unknown>
): Promise<GeminiResponse> {
  const model = options.model ?? TEXT_AGENT_MODEL;
  const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  const data = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) throw new Error(data.error?.message ?? `Gemini returned ${response.status}.`);
  return data;
}

export async function runTextTurn(userText: string, options: RunTextTurnOptions): Promise<void> {
  const { signal, onEvent, history } = options;
  const maxIterations = options.maxIterations ?? 8;

  if (!options.apiKey.trim()) {
    onEvent({ type: 'error', message: 'Add a Gemini API key to use the typed agent.' });
    return;
  }

  history.push({ role: 'user', parts: [{ text: userText }] });

  try {
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      if (signal.aborted) return;

      const modelContext = document.modelContext;
      if (!modelContext) throw new Error('This page has no document.modelContext.');
      const tools = await modelContext.getTools();

      const data = await callGemini(options, {
        systemInstruction: { parts: [{ text: options.systemInstruction }] },
        contents: history,
        tools: [{ functionDeclarations: toFunctionDeclarations(tools) }],
        generationConfig: { thinkingConfig: { thinkingLevel: TEXT_AGENT_THINKING_LEVEL } },
      });

      const candidate = data.candidates?.[0]?.content;
      if (!candidate) {
        onEvent({ type: 'error', message: 'The model returned nothing.' });
        return;
      }

      history.push(candidate);

      const calls = candidate.parts
        .map((part) => part.functionCall)
        .filter((call): call is GeminiFunctionCall => Boolean(call));

      if (calls.length === 0) {
        const text = candidate.parts
          .map((part) => part.text)
          .filter(Boolean)
          .join(' ')
          .trim();
        onEvent({ type: 'message', text: text || '(no reply text)' });
        return;
      }

      const responses: GeminiPart[] = [];

      for (const call of calls) {
        if (signal.aborted) return;
        onEvent({ type: 'tool-call', name: call.name, args: call.args ?? {} });

        const tool = tools.find((candidateTool: RegisteredTool) => candidateTool.name === call.name);
        if (!tool) {
          const message = `No tool named "${call.name}" is registered right now.`;
          onEvent({ type: 'tool-result', name: call.name, ok: false, summary: message });
          responses.push({ functionResponse: { name: call.name, response: { error: message } } });
          continue;
        }

        let parsed: unknown;
        try {
          // Chrome 151 rejects an object here with "Failed to parse input
          // arguments" and accepts a JSON string. Stringify always.
          const raw = await modelContext.executeTool(tool, JSON.stringify(call.args ?? {}), { signal });
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = { ok: true, text: raw };
          }
        } catch (error) {
          parsed = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }

        const { ok, summary } = summarize(parsed);
        onEvent({ type: 'tool-result', name: call.name, ok, summary });
        responses.push({
          functionResponse: { name: call.name, response: (parsed ?? {}) as Record<string, unknown> },
        });
      }

      history.push({ role: 'user', parts: responses });
    }

    onEvent({
      type: 'error',
      message: `Stopped after ${maxIterations} tool-call rounds without a final reply.`,
    });
  } catch (error) {
    if (signal.aborted) return;
    onEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}
