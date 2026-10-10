import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form'
import type { MissionDraft } from '../../features/missions/validation'
import { newObjective } from '../../features/missions/templates'
import type { EvaluationMode, MetricKey, Registry } from '../../types/mission'

const modeDescriptions: Record<EvaluationMode, string> = {
  final: 'Evaluated at the actual completion time, including an early finish.',
  maintained:
    'Must hold throughout the history from time zero; a breach remains after recovery.',
  deadline:
    'First qualifying achievement must be at or before the inclusive deadline, even if the value later declines.',
  accumulated:
    'Compares a supported cumulative total; sampled gauges are never added together.',
}
export default function ObjectiveEditor({
  form,
  registry,
  disabled = false,
}: {
  form: UseFormReturn<MissionDraft>
  registry: Registry
  disabled?: boolean
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'objectives',
    keyName: 'form_key',
  })
  const objectives = useWatch({ control: form.control, name: 'objectives' })
  const requiredCount = objectives.filter((o) => o.required).length
  const errors = form.formState.errors.objectives
  return (
    <div className="cg-objective-list">
      <p className="cg-help">
        Objectives are evaluated by the backend. A current gauge alone cannot
        prove a historical or deadline result.
      </p>
      {(errors?.root?.message ?? errors?.message) && (
        <p className="cg-field-error" role="alert">
          {String(errors?.root?.message ?? errors?.message)}
        </p>
      )}
      {fields.map((field, index) => {
        const objective = objectives[index],
          metric = registry.metrics[objective.metric_key]
        const prefix = `objectives.${index}` as const
        const error = errors?.[index]
        return (
          <fieldset
            className="cg-objective"
            key={field.form_key}
            disabled={disabled}
          >
            <legend>Objective {index + 1}</legend>
            <div className="cg-grid">
              <label className="cg-field">
                <span>Objective name</span>
                <input
                  {...form.register(`${prefix}.name`)}
                  aria-invalid={Boolean(error?.name)}
                />
                {error?.name && (
                  <span className="cg-field-error">{error.name.message}</span>
                )}
              </label>
              <label className="cg-field">
                <span>Metric</span>
                <select
                  aria-label="Metric"
                  {...form.register(`${prefix}.metric_key`)}
                  onChange={(event) => {
                    const key = event.target.value as MetricKey,
                      definition = registry.metrics[key]
                    form.setValue(`${prefix}.metric_key`, key, {
                      shouldDirty: true,
                    })
                    if (
                      !definition.supported_modes.includes(
                        objective.evaluation_mode,
                      )
                    ) {
                      form.setValue(
                        `${prefix}.evaluation_mode`,
                        definition.supported_modes[0],
                        { shouldDirty: true },
                      )
                      form.setValue(`${prefix}.deadline_seconds`, null, {
                        shouldDirty: true,
                      })
                    }
                    if (!definition.operators.includes(objective.operator))
                      form.setValue(
                        `${prefix}.operator`,
                        definition.operators[0],
                        { shouldDirty: true },
                      )
                  }}
                >
                  {Object.values(registry.metrics).map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name} ({item.unit || 'count'})
                    </option>
                  ))}
                </select>
              </label>
              <label className="cg-field">
                <span>Comparison operator</span>
                <select
                  aria-label="Comparison operator"
                  {...form.register(`${prefix}.operator`)}
                >
                  {metric.operators.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cg-field">
                <span>Threshold ({metric.unit || 'count'})</span>
                <input
                  aria-label={`Threshold (${metric.unit || 'count'})`}
                  type="number"
                  step="any"
                  {...form.register(`${prefix}.target_value`, {
                    valueAsNumber: true,
                  })}
                  aria-invalid={Boolean(error?.target_value)}
                />
                <small>
                  {metric.value_type === 'integer' ? 'Integer count. ' : ''}
                  Minimum {metric.minimum}
                  {metric.maximum !== null ? `; maximum ${metric.maximum}` : ''}
                  .
                </small>
                {error?.target_value && (
                  <span className="cg-field-error">
                    {error.target_value.message}
                  </span>
                )}
              </label>
              <label className="cg-field">
                <span>Evaluation mode</span>
                <select
                  aria-label="Evaluation mode"
                  {...form.register(`${prefix}.evaluation_mode`)}
                  onChange={(event) => {
                    const mode = event.target.value as EvaluationMode
                    form.setValue(`${prefix}.evaluation_mode`, mode, {
                      shouldDirty: true,
                    })
                    form.setValue(
                      `${prefix}.deadline_seconds`,
                      mode === 'deadline' ? 0 : null,
                      { shouldDirty: true },
                    )
                  }}
                >
                  {metric.supported_modes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
                <small>{modeDescriptions[objective.evaluation_mode]}</small>
                {error?.evaluation_mode && (
                  <span className="cg-field-error">
                    {error.evaluation_mode.message}
                  </span>
                )}
              </label>
              {objective.evaluation_mode === 'deadline' && (
                <label className="cg-field">
                  <span>Deadline (seconds)</span>
                  <input
                    aria-label="Deadline (seconds)"
                    type="number"
                    step="any"
                    {...form.register(`${prefix}.deadline_seconds`, {
                      setValueAs: (value) =>
                        value === null
                          ? null
                          : value === ''
                            ? NaN
                            : Number(value),
                    })}
                    aria-invalid={Boolean(error?.deadline_seconds)}
                  />
                  <small>Inclusive; must fall within mission duration.</small>
                  {error?.deadline_seconds && (
                    <span className="cg-field-error">
                      {error.deadline_seconds.message}
                    </span>
                  )}
                </label>
              )}
            </div>
            {objective.evaluation_mode !== 'deadline' &&
              error?.deadline_seconds && (
                <p className="cg-field-error" role="alert">
                  {error.deadline_seconds.message}
                </p>
              )}
            <label className="cg-field">
              <span>Objective description</span>
              <textarea {...form.register(`${prefix}.description`)} />
            </label>
            <div className="cg-actions spread">
              <label className="cg-check">
                <input
                  type="checkbox"
                  {...form.register(`${prefix}.required`)}
                />
                Required for mission success
              </label>
              <button
                className="button ghost"
                type="button"
                onClick={() => remove(index)}
                disabled={
                  disabled || (objective.required && requiredCount <= 1)
                }
                aria-label={`Delete objective ${index + 1}`}
              >
                Delete objective
              </button>
            </div>
            {objective.required && requiredCount <= 1 && (
              <small className="cg-help">
                The last required objective cannot be deleted.
              </small>
            )}
          </fieldset>
        )
      })}
      <button
        type="button"
        className="button"
        onClick={() => append(newObjective())}
        disabled={disabled}
      >
        Add objective
      </button>
    </div>
  )
}
