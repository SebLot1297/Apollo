import { useRef, useState, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, PageHeading, PanelTitle } from '../components/ui/Primitives'
import { ErrorNotice, Loading } from '../components/ui/Feedback'
import { api } from '../services/api'
import {
  keys,
  useProviders,
  useReadiness,
  useSettings,
} from '../services/queries'
import { finite } from '../features/missions/validation'
import type { Preferences, Settings as SettingsData } from '../types/mission'
import { useDirtyGuard } from '../features/missions/useDirtyGuard'
import {
  capSimulationSpeed,
  simulationSpeedHelp,
} from '../utils/simulationSpeed'
const schema = z.object({
  ai_provider: z.enum(['auto', 'gemini', 'qwen', 'mock']),
  demo_mode: z.boolean(),
  simulation_speed: finite.positive().transform(capSimulationSpeed),
})
export default function Settings() {
  const settings = useSettings(),
    readiness = useReadiness(),
    providers = useProviders()
  return (
    <div className="page cg-stack">
      <PageHeading
        eyebrow="WORKSPACE PREFERENCES"
        title="Workspace settings"
        description="Server-owned preferences, infrastructure readiness, and provider availability."
      />
      <ErrorNotice
        error={settings.error ?? readiness.error ?? providers.error}
        retry={() => {
          void settings.refetch()
          void readiness.refetch()
          void providers.refetch()
        }}
      />
      {settings.isPending ? (
        <Loading />
      ) : (
        settings.data && (
          <div className="cg-grid">
            <PreferencesForm initial={settings.data} />
            <section className="panel">
              <PanelTitle title="Backend readiness" />
              <dl className="cg-facts cg-content">
                <dt>Database engine</dt>
                <dd>{settings.data.database.engine}</dd>
                <dt>Database status</dt>
                <dd>{settings.data.database.status}</dd>
                <dt>Storage mode</dt>
                <dd>
                  {settings.data.database.engine.startsWith('sqlite')
                    ? 'SQLite local-demo; no Timescale verification implied.'
                    : 'PostgreSQL / TimescaleDB'}
                </dd>
                <dt>Backend</dt>
                <dd>{readiness.data?.status ?? 'Unverified'}</dd>
                <dt>Simulation engine</dt>
                <dd>
                  {readiness.data?.simulation_engine_ready
                    ? 'Ready'
                    : 'Unavailable / unverified'}
                </dd>
                <dt>AI service</dt>
                <dd>
                  {readiness.data?.ai_service_ready
                    ? 'Installed'
                    : 'Part D unavailable'}
                </dd>
              </dl>
            </section>
          </div>
        )
      )}
      <section className="panel">
        <PanelTitle
          title="AI provider availability"
          meta={
            <button
              className="button"
              disabled={providers.isFetching}
              onClick={() => void providers.refetch()}
            >
              Refresh provider status
            </button>
          }
        />
        {providers.isPending ? (
          <Loading />
        ) : (
          <ul className="cg-list">
            {providers.data?.map((status) => (
              <li key={status.provider}>
                <div className="cg-actions spread">
                  <strong>
                    {status.provider} · {status.model}
                  </strong>
                  <Badge tone={status.available ? 'green' : 'amber'}>
                    {status.available ? 'Available' : 'Unavailable'}
                  </Badge>
                </div>
                <span>
                  Configured: {status.configured ? 'Yes' : 'No'} · Available:{' '}
                  {status.available ? 'Yes' : 'No'}
                </span>
                <p className="cg-help">{status.detail}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="cg-help cg-content">
          Configured does not imply available. Provider secrets are never
          returned or displayed. Core simulation needs no AI key or GPU.
        </p>
      </section>
    </div>
  )
}
function PreferencesForm({ initial }: { initial: SettingsData }) {
  const client = useQueryClient(),
    [error, setError] = useState<unknown>(null),
    [saved, setSaved] = useState(false)
  const form = useForm<Preferences>({
    defaultValues: {
      ai_provider: initial.ai_provider,
      demo_mode: initial.demo_mode,
      simulation_speed: initial.simulation_speed,
    },
    values: {
      ai_provider: initial.ai_provider,
      demo_mode: initial.demo_mode,
      simulation_speed: initial.simulation_speed,
    },
    resetOptions: { keepDirtyValues: true },
    resolver: zodResolver(schema),
  })
  useDirtyGuard(form.formState.isDirty)
  const saving = useRef(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    void form.handleSubmit(async (values) => {
      if (saving.current) return
      saving.current = true
      setError(null)
      setSaved(false)
      try {
        const result = await api.saveSettings(values)
        await client.cancelQueries({ queryKey: keys.settings })
        client.setQueryData(keys.settings, result)
        form.reset(
          {
            ai_provider: result.ai_provider,
            demo_mode: result.demo_mode,
            simulation_speed: result.simulation_speed,
          },
          { keepDirtyValues: false },
        )
        setSaved(true)
        void client.invalidateQueries({ queryKey: keys.providers })
        void client.invalidateQueries({ queryKey: keys.runs })
        void client.invalidateQueries({ queryKey: ['run'] })
      } catch (failure) {
        setError(failure)
      } finally {
        saving.current = false
      }
    })(event)
  }
  return (
    <form className="panel cg-content cg-form" noValidate onSubmit={submit}>
      <h2 className="cg-section-title">Preferences</h2>
      <ErrorNotice error={error} />
      {saved && !form.formState.isDirty && (
        <p className="cg-notice success" role="status">
          Preferences saved to the server.
        </p>
      )}
      <label className="cg-field">
        <span>Preferred AI provider</span>
        <select
          disabled={form.formState.isSubmitting}
          {...form.register('ai_provider')}
        >
          <option value="auto">Automatic</option>
          <option value="gemini">Gemini</option>
          <option value="qwen">Qwen</option>
          <option value="mock">Mock / demo</option>
        </select>
      </label>
      <label className="cg-check">
        <input
          type="checkbox"
          disabled={form.formState.isSubmitting}
          {...form.register('demo_mode')}
        />
        Demo mode
      </label>
      <label className="cg-field">
        <span>Default simulation speed</span>
        <input
          type="number"
          step="any"
          disabled={form.formState.isSubmitting}
          {...form.register('simulation_speed', { valueAsNumber: true })}
          aria-invalid={Boolean(form.formState.errors.simulation_speed)}
          aria-describedby="default-speed-help"
        />
        <small id="default-speed-help">
          Saved for all missions. Updates the current unfinished simulation and
          provides the default for future launches and resets.{' '}
          {simulationSpeedHelp} Individual runs can also be adjusted in Mission
          Control.
        </small>
        {form.formState.errors.simulation_speed && (
          <span className="cg-field-error" role="alert">
            {form.formState.errors.simulation_speed.message}
          </span>
        )}
      </label>
      <button
        className="button primary"
        disabled={form.formState.isSubmitting}
        type="submit"
      >
        {form.formState.isSubmitting ? 'Saving…' : 'Save preferences'}
      </button>
    </form>
  )
}
