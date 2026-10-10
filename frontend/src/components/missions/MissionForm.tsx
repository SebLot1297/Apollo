import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  useForm,
  useWatch,
  type FieldPath,
  type UseFormReturn,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  draftSchema,
  serializeDraft,
  toDraft,
  type MissionDraft,
} from '../../features/missions/validation'
import { signalRestoreTemplate } from '../../features/missions/templates'
import { useDirtyGuard } from '../../features/missions/useDirtyGuard'
import type { MissionConfiguration, Registry } from '../../types/mission'
import { ApiError } from '../../services/api'
import { useConfirm } from '../ui/confirmation'
import { ErrorNotice } from '../ui/Feedback'
import ObjectiveEditor from './ObjectiveEditor'
import ProposalPanel from '../ai/ProposalPanel'

const parameterLabels = {
  weather_severity: 'Weather severity',
  environmental_disruption: 'Environmental disruption',
  team_count: 'Support team count',
  equipment_reliability: 'Equipment reliability',
  resource_level: 'Resource level',
  communication_reliability: 'Communication reliability',
} as const
export default function MissionForm({
  initial,
  registry,
  editing,
  objectivesOnly = false,
  onSave,
  afterSave,
}: {
  initial: MissionConfiguration
  registry: Registry
  editing: boolean
  objectivesOnly?: boolean
  onSave: (mission: MissionConfiguration) => Promise<MissionConfiguration>
  afterSave?: (mission: MissionConfiguration) => void
}) {
  const form = useForm<MissionDraft>({
    defaultValues: toDraft(initial),
    resolver: zodResolver(draftSchema(registry)),
    shouldFocusError: true,
  })
  const draft = useWatch({ control: form.control }) as MissionDraft
  const [baseline, setBaseline] = useState(initial)
  const [step, setStep] = useState(0),
    [error, setError] = useState<unknown>(null),
    [saved, setSaved] = useState(false)
  const confirm = useConfirm(),
    allowNavigation = useDirtyGuard(form.formState.isDirty)
  const saving = useRef(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    void form.handleSubmit(
      async (values) => {
        if (saving.current) return
        saving.current = true
        setError(null)
        setSaved(false)
        try {
          const mission = await onSave(
            serializeDraft(values, baseline.parameters.team_count),
          )
          form.reset(toDraft(mission))
          setBaseline(mission)
          setSaved(true)
          allowNavigation()
          afterSave?.(mission)
        } catch (failure) {
          setError(failure)
          if (failure instanceof ApiError)
            failure.fields.forEach((field, index) => {
              const path = field.loc
                .filter((p) => p !== 'body')
                .join('.') as FieldPath<MissionDraft>
              if (path)
                form.setError(
                  path,
                  { type: 'server', message: field.msg },
                  { shouldFocus: index === 0 },
                )
            })
        } finally {
          saving.current = false
        }
      },
      () => {
        if (!objectivesOnly) setStep(3)
      },
    )(event)
  }
  const apply = (proposal: MissionConfiguration) => {
    for (const key of Object.keys(toDraft(proposal)) as (keyof MissionDraft)[])
      form.setValue(key, toDraft(proposal)[key] as never, {
        shouldDirty: true,
        shouldValidate: true,
      })
    setSaved(false)
  }
  const steps = [
    '1 · Mission information',
    '2 · Operational conditions',
    '3 · Objectives',
    '4 · Review and save',
  ]
  return (
    <form
      className="cg-form"
      noValidate
      onSubmit={submit}
      aria-label={
        objectivesOnly
          ? 'Objective designer form'
          : 'Mission configuration form'
      }
    >
      {!objectivesOnly && (
        <ol className="cg-steps" aria-label="Builder steps">
          {steps.map((label, index) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(index)}
                aria-current={step === index ? 'step' : undefined}
              >
                {label}
              </button>
            </li>
          ))}
        </ol>
      )}
      <ErrorNotice error={error} />
      {saved && (
        <div role="status" className="cg-notice success">
          Configuration saved to the backend.
        </div>
      )}
      {/* Keep every field mounted so an invalid hidden step can receive error focus. */}
      {!objectivesOnly && (
        <section
          className="panel cg-content cg-stack"
          hidden={step !== 0 && step !== 3}
        >
          <h2 className="cg-section-title">Mission information</h2>
          <div className="cg-actions">
            <span className="cg-help">
              Template is an unsaved, editable configuration.
            </span>
            <button
              type="button"
              className="button"
              onClick={async () => {
                if (
                  form.formState.isDirty &&
                  !(await confirm({
                    title: 'Replace this draft?',
                    description:
                      'The template replaces unsaved mission fields.',
                    confirmText: 'Use template',
                  }))
                )
                  return
                const template = signalRestoreTemplate()
                apply(
                  editing
                    ? {
                        ...template,
                        id: baseline.id,
                        created_at: baseline.created_at,
                        facilities: baseline.facilities,
                        support_teams: [],
                        objectives: template.objectives.map(
                          (objective, index) => ({
                            ...objective,
                            id: baseline.objectives[index]?.id ?? objective.id,
                          }),
                        ),
                      }
                    : template,
                )
              }}
            >
              Use Signal Restore template
            </button>
          </div>
          <div className="cg-grid">
            <Field form={form} path="name" label="Mission name">
              <input
                {...form.register('name')}
                aria-invalid={Boolean(form.formState.errors.name)}
              />
            </Field>
            <Field
              form={form}
              path="duration_seconds"
              label="Duration (seconds)"
            >
              <input
                type="number"
                step="1"
                {...form.register('duration_seconds', { valueAsNumber: true })}
                aria-invalid={Boolean(form.formState.errors.duration_seconds)}
              />
              <small>60–86400 seconds. Six hours = 21600 seconds.</small>
            </Field>
            <label className="cg-field">
              <span>Category</span>
              <select {...form.register('category')}>
                {registry.categories.map((category) => (
                  <option
                    key={category.key}
                    value={category.key}
                    disabled={!category.available}
                  >
                    {category.label}
                    {category.available ? '' : ' — unavailable'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Field form={form} path="description" label="Mission description">
            <textarea {...form.register('description')} />
          </Field>
        </section>
      )}
      {!objectivesOnly && (
        <section
          className="panel cg-content cg-stack"
          hidden={step !== 1 && step !== 3}
        >
          <h2 className="cg-section-title">Operational conditions</h2>
          <div className="cg-grid">
            {Object.entries(parameterLabels).map(([key, label]) => {
              const path = `parameters.${key}` as FieldPath<MissionDraft>,
                definition = registry.parameters[key]
              return (
                <Field
                  key={key}
                  form={form}
                  path={path}
                  label={`${label} (${key === 'team_count' ? 'count' : '%'})`}
                >
                  <input
                    type="number"
                    step={key === 'team_count' ? '1' : 'any'}
                    {...form.register(path, { valueAsNumber: true })}
                    aria-invalid={Boolean(
                      form.getFieldState(path, form.formState).error,
                    )}
                  />
                  <small>{definition?.effects}</small>
                </Field>
              )
            })}
          </div>
          <label className="cg-check">
            <input
              type="checkbox"
              {...form.register('parameters.backup_power_enabled')}
            />
            Backup power enabled
          </label>
          <Field
            form={form}
            path="metadata_text"
            label="Custom metadata (JSON scalar object)"
          >
            <textarea
              className="mono"
              {...form.register('metadata_text')}
              aria-invalid={Boolean(form.formState.errors.metadata_text)}
            />
            <small>
              Strings, booleans, finite numbers, and null only. Metadata has no
              numerical effects and is never executed.
            </small>
          </Field>
        </section>
      )}
      <section
        className="panel cg-content cg-stack"
        hidden={!objectivesOnly && step !== 2 && step !== 3}
      >
        <h2 className="cg-section-title">Measurable objectives</h2>
        <ObjectiveEditor
          form={form}
          registry={registry}
          disabled={form.formState.isSubmitting}
        />
      </section>
      {!objectivesOnly && step === 3 && (
        <section className="panel cg-content cg-review">
          <h2 className="cg-section-title">Review configuration</h2>
          <p className="cg-help">
            {editing
              ? 'Updates retain this mission identity. Running and historical snapshots remain independent.'
              : 'This draft will become a saved mission only when you choose Save mission.'}
          </p>
          <dl>
            <dt>Mission</dt>
            <dd>{draft.name}</dd>
            <dt>Category</dt>
            <dd>Communications Recovery</dd>
            <dt>Duration</dt>
            <dd>{draft.duration_seconds} seconds</dd>
            <dt>Teams</dt>
            <dd>{draft.parameters.team_count}</dd>
            <dt>Objectives</dt>
            <dd>
              {draft.objectives.length};{' '}
              {draft.objectives.filter((o) => o.required).length} required
            </dd>
          </dl>
          {editing && (
            <div>
              <h3 className="cg-section-title">Changes</h3>
              <ul className="cg-help">
                {[
                  'name',
                  'description',
                  'duration_seconds',
                  'parameters',
                  'objectives',
                ]
                  .filter(
                    (key) =>
                      JSON.stringify(draft[key as keyof MissionDraft]) !==
                      JSON.stringify(
                        baseline[key as keyof MissionConfiguration],
                      ),
                  )
                  .map((key) => (
                    <li key={key}>{key.replaceAll('_', ' ')} changed</li>
                  ))}
                {draft.metadata_text !== toDraft(baseline).metadata_text && (
                  <li>custom metadata changed</li>
                )}
              </ul>
            </div>
          )}
        </section>
      )}
      <div className="cg-actions spread">
        {!objectivesOnly && (
          <>
            <button
              type="button"
              className="button"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              Previous step
            </button>
            {step < 3 && (
              <button
                type="button"
                className="button primary"
                onClick={async () => {
                  const fields: FieldPath<MissionDraft>[] =
                    step === 0
                      ? ['name', 'duration_seconds', 'category']
                      : step === 1
                        ? ['parameters', 'metadata_text']
                        : ['objectives']
                  if (await form.trigger(fields, { shouldFocus: true }))
                    setStep(step + 1)
                }}
              >
                Next step
              </button>
            )}
          </>
        )}
        {(objectivesOnly || step === 3) && (
          <button
            type="submit"
            className="button primary"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting
              ? 'Saving…'
              : objectivesOnly
                ? 'Save objectives'
                : 'Save mission'}
          </button>
        )}
      </div>
      <section className="panel cg-content">
        <ProposalPanel
          mission={draft}
          registry={registry}
          savedMission={editing}
          onApply={apply}
          objectivesOnly={objectivesOnly}
        />
      </section>
    </form>
  )
}
function Field({
  form,
  path,
  label,
  children,
}: {
  form: UseFormReturn<MissionDraft>
  path: FieldPath<MissionDraft>
  label: string
  children: ReactNode
}) {
  const error = form.getFieldState(path, form.formState).error
  const hintId = useId(),
    errorId = useId()
  const hasHint = Children.toArray(children).some(
    (child) => isValidElement(child) && child.type === 'small',
  )
  return (
    <label className="cg-field">
      <span>{label}</span>
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child
        const element = child as ReactElement<Record<string, unknown>>
        if (['input', 'textarea', 'select'].includes(String(child.type)))
          return cloneElement(element, {
            'aria-label': label,
            'aria-describedby':
              [hasHint ? hintId : '', error ? errorId : '']
                .filter(Boolean)
                .join(' ') || undefined,
            disabled: form.formState.isSubmitting,
          })
        if (child.type === 'small') return cloneElement(element, { id: hintId })
        return child
      })}
      {error && (
        <span id={errorId} className="cg-field-error" role="alert">
          {typeof error.message === 'string' ? error.message : 'Invalid value'}
        </span>
      )}
    </label>
  )
}
