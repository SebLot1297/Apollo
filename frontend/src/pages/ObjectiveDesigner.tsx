import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { PageHeading } from '../components/ui/Primitives'
import { Empty, ErrorNotice, Loading } from '../components/ui/Feedback'
import MissionForm from '../components/missions/MissionForm'
import { api } from '../services/api'
import {
  cacheMission,
  useMission,
  useMissions,
  useObjectives,
  useRegistry,
} from '../services/queries'
import type { MissionConfiguration } from '../types/mission'

export default function ObjectiveDesigner() {
  const { missionId = '' } = useParams(),
    client = useQueryClient()
  const missions = useMissions(),
    mission = useMission(missionId),
    registry = useRegistry(),
    objectives = useObjectives(missionId)
  const save = async (next: MissionConfiguration) => {
    const original = objectives.data ?? mission.data!.objectives
    const added = next.objectives.filter(
      (o) => !original.some((old) => old.id === o.id),
    )
    const deleted = original.filter(
      (o) => !next.objectives.some((current) => current.id === o.id),
    )
    const changed = next.objectives.filter((o) =>
      original.some(
        (old) =>
          old.id === o.id &&
          Object.keys(o).some(
            (key) => o[key as keyof typeof o] !== old[key as keyof typeof old],
          ),
      ),
    )
    if (added.length + deleted.length + changed.length !== 1)
      await api.saveMission(next, true)
    else if (added.length) await api.addObjective(missionId, added[0])
    else if (deleted.length) await api.deleteObjective(deleted[0].id)
    else await api.updateObjective(changed[0])
    const saved = await api.mission(missionId)
    await cacheMission(client, saved)
    return saved
  }
  return (
    <div className="page cg-stack">
      <PageHeading
        eyebrow="MEASURABLE SUCCESS"
        title="Objective designer"
        description="Use registered metrics, units, and historical evaluation modes. The server evaluates results."
      />
      <ErrorNotice
        error={
          registry.error ?? mission.error ?? objectives.error ?? missions.error
        }
        retry={() => {
          void registry.refetch()
          void missions.refetch()
          if (missionId) {
            void mission.refetch()
            void objectives.refetch()
          }
        }}
      />
      {!missionId ? (
        missions.isPending ? (
          <Loading />
        ) : (
          <section className="panel cg-content cg-stack">
            <h2 className="cg-section-title">Choose a saved mission</h2>
            {missions.data?.length ? (
              missions.data.map((config) => (
                <Link
                  className="button"
                  key={config.id}
                  to={`/objectives/${config.id}`}
                >
                  {config.name}
                </Link>
              ))
            ) : (
              <Empty title="No saved missions">
                <Link className="button" to="/mission-builder">
                  Create mission
                </Link>
              </Empty>
            )}
            <Link className="button" to="/mission-builder">
              Design objectives in a new draft
            </Link>
          </section>
        )
      ) : mission.isPending || registry.isPending || objectives.isPending ? (
        <Loading />
      ) : (
        mission.data &&
        registry.data &&
        objectives.data && (
          <MissionForm
            key={missionId}
            initial={{ ...mission.data, objectives: objectives.data }}
            registry={registry.data}
            editing
            objectivesOnly
            onSave={save}
          />
        )
      )}
    </div>
  )
}
