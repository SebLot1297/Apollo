import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  FileChartColumn,
  FolderOpen,
  Radio,
  ShieldCheck,
} from 'lucide-react'
import { Badge, PageHeading, PanelTitle } from '../components/ui/Primitives'
import { Empty, ErrorNotice, Loading } from '../components/ui/Feedback'
import { useConfirm } from '../components/ui/confirmation'
import ScenarioMap from '../components/dashboard/ScenarioMap'
import { api } from '../services/api'
import {
  cacheState,
  invalidateMission,
  keys,
  useMissions,
  useReports,
  useRuns,
  useSettings,
} from '../services/queries'
import { parseState } from '../services/state'
import { useWorkspace } from '../store/workspace'
import { isTerminal } from '../types/mission'
import { elapsed, localDate } from '../utils/format'

export default function Dashboard() {
  const client = useQueryClient(),
    navigate = useNavigate(),
    confirm = useConfirm()
  const missions = useMissions(),
    runs = useRuns(client),
    reports = useReports(),
    settings = useSettings()
  const [seed, setSeed] = useState('42'),
    [error, setError] = useState<unknown>(null)
  const active = runs.data?.find((run) => !isTerminal(run.status)),
    latest = reports.data?.[0]
  const launch = useMutation({
    mutationFn: async (missionId: string) => {
      const randomSeed = Number(seed)
      if (
        !seed.trim() ||
        !Number.isInteger(randomSeed) ||
        randomSeed < -2147483648 ||
        randomSeed > 2147483647
      )
        throw new Error(
          'Random seed must be an integer between -2147483648 and 2147483647.',
        )
      if (!settings.data)
        throw new Error('Load server preferences before launching.')
      return parseState(
        await api.createRun(
          missionId,
          randomSeed,
          settings.data.simulation_speed,
        ),
      )
    },
    onSuccess: (state) => {
      cacheState(client, state.run_id, state)
      useWorkspace.getState().selectRun(state.run_id)
      void client.invalidateQueries({ queryKey: keys.runs })
      navigate(`/mission-control/${state.run_id}`)
    },
    onError: (failure) => {
      setError(failure)
      void client.invalidateQueries({ queryKey: keys.runs })
    },
  })
  const launchDemo = useMutation({
    mutationFn: () => api.createDemo(),
    onSuccess: (incoming) => {
      const state = parseState(incoming)
      cacheState(client, state.run_id, state)
      useWorkspace.getState().selectRun(state.run_id)
      void client.invalidateQueries({ queryKey: keys.runs })
      navigate(`/mission-control/${state.run_id}`)
    },
    onError: setError,
  })
  const remove = useMutation({
    mutationFn: api.deleteMission,
    onSuccess: (_, id) => void invalidateMission(client, id),
    onError: setError,
  })
  const stats = [
    { label: 'SAVED MISSIONS', value: missions.data?.length, icon: FolderOpen },
    {
      label: 'TERMINAL RUNS',
      value: runs.data?.filter((run) => isTerminal(run.status)).length,
      icon: ShieldCheck,
    },
    {
      label: 'ACTIVE SIMULATION',
      value: runs.data ? (active ? 1 : 0) : undefined,
      icon: Radio,
    },
    {
      label: 'LATEST RESULT',
      value: latest
        ? latest.success
          ? 'Success'
          : 'Unsuccessful'
        : reports.data
          ? '—'
          : undefined,
      icon: FileChartColumn,
    },
  ]
  return (
    <div className="page dashboard-page cg-stack">
      <PageHeading
        eyebrow="OPERATIONS OVERVIEW"
        title="Command dashboard"
        description="Saved configurations, real server activity, and persisted results."
      >
        <Link className="button primary" to="/mission-builder">
          Create mission
        </Link>
        <button
          className="button"
          disabled={launchDemo.isPending || Boolean(active) || !settings.data}
          title={
            active
              ? 'Finish or terminate the active run before launching the demo.'
              : 'Start the repeatable guided Hackathon Recovery Demo.'
          }
          onClick={() => {
            if (!launchDemo.isPending) {
              setError(null)
              launchDemo.mutate()
            }
          }}
        >
          Launch guided demo
        </button>
      </PageHeading>
      <ErrorNotice
        error={
          error ??
          missions.error ??
          runs.error ??
          reports.error ??
          settings.error
        }
        retry={() => {
          setError(null)
          void missions.refetch()
          void runs.refetch()
          void reports.refetch()
          void settings.refetch()
        }}
      />
      <div className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-label">
              {stat.label}
              <stat.icon size={17} />
            </div>
            <div className="stat-value">{stat.value ?? '…'}</div>
            <div className="stat-detail">Confirmed backend data</div>
          </div>
        ))}
      </div>
      <div className="cg-grid">
        <section className="panel">
          <PanelTitle title="Active simulation" icon={Activity} />
          {active ? (
            <div className="cg-content cg-stack">
              <h2 className="cg-section-title">{active.mission.name}</h2>
              <div className="cg-actions">
                <Badge tone="green">{active.status}</Badge>
                <span className="mono">
                  T+ {elapsed(active.elapsed_time_seconds)}
                </span>
              </div>
              <Link
                className="button primary"
                to={`/mission-control/${active.run_id}`}
              >
                Open active run
              </Link>
              <ScenarioMap
                facilities={active.facilities}
                teams={active.support_teams}
              />
            </div>
          ) : runs.isPending ? (
            <Loading />
          ) : (
            <Empty title="No active simulation">
              <p>
                Launch a saved mission, then explicitly start it in Mission
                Control.
              </p>
            </Empty>
          )}
        </section>
        <section className="panel">
          <PanelTitle title="Latest saved result" />
          <div className="cg-content cg-stack">
            {latest ? (
              <>
                <h2 className="cg-section-title">{latest.mission.name}</h2>
                <Badge tone={latest.success ? 'green' : 'red'}>
                  {latest.success ? 'Success' : 'Unsuccessful'}
                </Badge>
                <p className="cg-help">{latest.summary}</p>
                <Link className="button" to={`/reports/${latest.run_id}`}>
                  Open latest report
                </Link>
              </>
            ) : reports.isPending ? (
              <Loading />
            ) : (
              <p className="cg-help">
                No saved reports yet. Completed, failed, and terminated runs
                produce reports.
              </p>
            )}
            <Link className="button" to="/reports">
              Browse reports and compare runs
            </Link>
          </div>
        </section>
      </div>
      <section className="mission-library cg-stack">
        <div className="section-heading">
          <div>
            <h2>
              Mission library{' '}
              <span className="count-chip">{missions.data?.length ?? '…'}</span>
            </h2>
            <p>
              Fictional Communications Recovery configurations saved to the
              server.
            </p>
          </div>
          <label className="cg-field">
            <span>Future run random seed</span>
            <input
              type="number"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>
        </div>
        {missions.isPending ? (
          <Loading />
        ) : !missions.data?.length ? (
          <Empty title="No saved missions">
            <Link className="button" to="/mission-builder">
              Create your first mission
            </Link>
          </Empty>
        ) : (
          <div className="cg-grid">
            {missions.data.map((mission) => (
              <article
                className="panel cg-run-card"
                key={mission.id}
                aria-label={`Mission ${mission.name}`}
              >
                <div className="cg-actions spread">
                  <Radio size={20} />
                  <Badge tone="cyan">Communications Recovery</Badge>
                </div>
                <h3>{mission.name}</h3>
                <p className="cg-help">{mission.description}</p>
                <span className="cg-help">
                  {mission.duration_seconds} seconds ·{' '}
                  {mission.parameters.team_count} teams ·{' '}
                  {mission.objectives.length} objectives · Updated{' '}
                  {localDate(mission.updated_at)}
                </span>
                <div className="cg-actions">
                  <Link
                    className="button"
                    to={`/mission-builder/${mission.id}`}
                  >
                    Edit
                  </Link>
                  <Link className="button" to={`/objectives/${mission.id}`}>
                    Objectives
                  </Link>
                  <Link
                    className="button"
                    to={`/mission-builder?clone=${mission.id}`}
                  >
                    Clone
                  </Link>
                  <button
                    className="button ghost"
                    disabled={remove.isPending}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: 'Delete mission?',
                          description: `Delete ${mission.name}? Historical reports remain available. Missions with an active run cannot be deleted.`,
                          confirmText: 'Delete mission',
                        })
                      )
                        remove.mutate(mission.id)
                    }}
                  >
                    Delete
                  </button>
                  {active ? (
                    <Link
                      className="button"
                      to={`/mission-control/${active.run_id}`}
                    >
                      Open active run
                    </Link>
                  ) : (
                    <button
                      className="button primary"
                      disabled={launch.isPending || !settings.data}
                      onClick={() => {
                        if (!launch.isPending) {
                          setError(null)
                          launch.mutate(mission.id)
                        }
                      }}
                    >
                      Launch
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <PanelTitle title="Recent run activity" />
        <ul className="cg-list">
          {(active ?? runs.data?.[0])?.events
            .slice(-5)
            .reverse()
            .map((event) => (
              <li key={event.id}>
                <span className="cg-event-time">
                  T+ {elapsed(event.simulated_time_seconds)}
                </span>
                <p>{event.message}</p>
              </li>
            ))}
        </ul>
        {!runs.data?.length && <p className="cg-empty">No run activity yet.</p>}
      </section>
    </div>
  )
}
