import { useEffect, useRef, type RefObject } from 'react';
import type { ApplicationField, ApplicationStep, FieldValue, JobPosting } from '../data/types';

const CONTROL =
  'w-full rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2.5 ' +
  'text-[0.9375rem] leading-6 text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] ' +
  'transition-colors hover:border-[var(--color-ink-faint)] focus-visible:border-[var(--color-accent)]';

interface ApplicationFormProps {
  posting: JobPosting;
  values: Record<string, Record<string, FieldValue>>;
  currentStepId: string;
  /** Fields written by a tool since the last render, for the one-shot flash. */
  justFilled: Set<string>;
  /** The one field the agent has asked about and is waiting on. */
  awaiting: { stepId: string; field: string } | null;
  submitted: boolean;
  submitRef: RefObject<HTMLButtonElement | null>;
  onChange: (stepId: string, field: string, value: FieldValue) => void;
  onOpenStep: (stepId: string) => void;
  onSubmit: () => void;
}

/**
 * The form, and the one rule the whole demo rests on:
 *
 * > **There is no code path from a tool to this submit handler.** The button is
 * > a real button, `prepare_submit` can move focus onto it, and that is where
 * > the agent stops. No confirmation dialog either: a dialog is the pattern
 * > that trains people to click through, and the honest version of "the human
 * > decides" is that the human presses the button that sends it.
 */
export function ApplicationForm({
  posting,
  values,
  currentStepId,
  justFilled,
  awaiting,
  submitted,
  submitRef,
  onChange,
  onOpenStep,
  onSubmit,
}: ApplicationFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      <p aria-live="polite" className="sr-only">
        {awaiting
          ? `Waiting for your answer: ${
              posting.steps
                .find((step) => step.id === awaiting.stepId)
                ?.fields.find((field) => field.name === awaiting.field)?.label ?? awaiting.field
            }`
          : ''}
      </p>

      {posting.steps.map((step, index) => (
        <StepPanel
          key={step.id}
          step={step}
          position={index + 1}
          current={step.id === currentStepId}
          values={values[step.id] ?? {}}
          justFilled={justFilled}
          awaiting={awaiting}
          onChange={onChange}
          onOpen={() => onOpenStep(step.id)}
        />
      ))}

      <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="text-[0.9375rem] leading-relaxed text-[var(--color-ink-muted)]">
          Read it back before you send it. The agent can put the cursor on this button. It cannot
          press it, and saying &ldquo;submit&rdquo; out loud does not press it either.
        </p>
        <button
          ref={submitRef}
          type="submit"
          className="mt-4 scroll-mt-[84px] rounded-[10px] bg-[var(--color-accent)] px-5 py-2.5 text-[0.9375rem] font-medium text-[var(--color-paper)] transition-colors hover:bg-[var(--color-accent-hover)] focus-visible:[box-shadow:0_0_0_3px_var(--color-accent-line)]"
        >
          Submit application
        </button>

        {submitted ? (
          <p
            role="status"
            className="mt-4 rounded-[10px] border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] px-4 py-3 text-[0.875rem] leading-relaxed text-[var(--color-ink)]"
          >
            You pressed it, so it counts. Nothing you filled in was sent anywhere: this page has
            no backend and no storage. Its only network calls are the voice session you started
            yourself and an anonymous count that the page was opened.
          </p>
        ) : null}
      </div>
    </form>
  );
}

function StepPanel({
  step,
  position,
  current,
  values,
  justFilled,
  awaiting,
  onChange,
  onOpen,
}: {
  step: ApplicationStep;
  position: number;
  current: boolean;
  values: Record<string, FieldValue>;
  justFilled: Set<string>;
  awaiting: { stepId: string; field: string } | null;
  onChange: (stepId: string, field: string, value: FieldValue) => void;
  onOpen: () => void;
}) {
  return (
    <section
      id={`step-${step.id}`}
      onFocus={onOpen}
      aria-current={current ? 'step' : undefined}
      className={[
        'scroll-mt-[84px] rounded-[14px] border bg-[var(--color-surface)] p-5 transition-colors',
        current
          ? 'border-[var(--color-accent-line)]'
          : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)]',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
          <span className="font-mono text-[0.75rem] text-[var(--color-ink-faint)]">
            {String(position).padStart(2, '0')}
          </span>{' '}
          {step.title}
        </h2>
      </div>

      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--color-ink-muted)]">
        {step.blurb}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {step.fields.map((field) => (
          <FieldRow
            key={field.name}
            field={field}
            stepId={step.id}
            value={values[field.name]}
            flash={justFilled.has(`${step.id}.${field.name}`)}
            awaited={awaiting?.stepId === step.id && awaiting.field === field.name}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
}

function FieldRow({
  field,
  stepId,
  value,
  flash,
  awaited,
  onChange,
}: {
  field: ApplicationField;
  stepId: string;
  value: FieldValue | undefined;
  flash: boolean;
  /** The agent asked about this one and is waiting for the person to answer. */
  awaited: boolean;
  onChange: (stepId: string, field: string, value: FieldValue) => void;
}) {
  const id = `${stepId}-${field.name}`;
  const ref = useRef<HTMLDivElement>(null);

  // Opening the step scrolls the step. In a six-field step the highlighted one
  // can still be below the fold, and a question you cannot see is not a
  // question that has been asked.
  useEffect(() => {
    if (awaited) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [awaited]);
  const wide = field.kind === 'textarea';
  const shown = value === undefined ? '' : String(value);
  const className = [CONTROL, flash ? 'field-just-filled' : '', awaited ? 'field-awaited' : '']
    .join(' ')
    .trim();

  return (
    <div ref={ref} className={`scroll-mt-[84px] ${wide ? 'sm:col-span-2' : ''}`}>
      <label htmlFor={id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] font-medium text-[var(--color-ink-muted)]">
        <span>
          {field.label}
          {field.required ? <span className="ml-1 text-[var(--color-ink-faint)]">*</span> : null}
        </span>
        {awaited ? (
          <span className="rounded-full border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] px-2 py-0.5 text-[0.6875rem] font-medium text-[var(--color-accent)]">
            Waiting for your answer
          </span>
        ) : null}
      </label>

      {field.help ? (
        <p className="mt-1 text-[0.75rem] text-[var(--color-ink-faint)]">{field.help}</p>
      ) : null}

      <div className="mt-1.5">
        {field.kind === 'textarea' ? (
          <textarea
            id={id}
            rows={3}
            value={shown}
            onChange={(event) => onChange(stepId, field.name, event.target.value)}
            className={`${className} resize-y`}
          />
        ) : field.kind === 'select' ? (
          <select
            id={id}
            value={shown}
            onChange={(event) => onChange(stepId, field.name, event.target.value)}
            className={className}
          >
            <option value="">Not answered</option>
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.kind === 'checkbox' ? (
          <label className="flex items-start gap-3 text-[0.875rem] leading-6 text-[var(--color-ink)]">
            <input
              id={id}
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(stepId, field.name, event.target.checked)}
              className="mt-1 size-[18px] shrink-0 rounded-[5px] border border-[var(--color-line-strong)] accent-[var(--color-accent)]"
            />
            <span>Tick it yourself, or tell the agent it is accurate and it will.</span>
          </label>
        ) : (
          <input
            id={id}
            type={field.kind === 'number' ? 'number' : field.kind}
            value={shown}
            onChange={(event) =>
              onChange(
                stepId,
                field.name,
                field.kind === 'number' ? Number(event.target.value) : event.target.value
              )
            }
            className={className}
          />
        )}
      </div>

    </div>
  );
}
