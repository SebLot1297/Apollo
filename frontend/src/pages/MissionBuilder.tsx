import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { PageHeading } from '../components/ui/Primitives'
import { ErrorNotice, Loading } from '../components/ui/Feedback'
import MissionForm from '../components/missions/MissionForm'
import {
  signalRestoreTemplate,
  cloneMission,
} from '../features/missions/templates'
import { api } from '../services/api'
import { useMission, useRegistry, invalidateMission } from '../services/queries'
import type { MissionConfiguration, Registry } from '../types/mission'
export default function MissionBuilder() {
  const { missionId = '' } = useParams(),
    [search] = useSearchParams()
  const cloneId = search.get('clone') ?? '',
    mission = useMission(missionId || cloneId),
    registry = useRegistry()
  const [blank] = useState(signalRestoreTemplate)
  const editing = Boolean(missionId)
  return (
    <div className="page cg-stack">
      <PageHeading
        eyebrow="MISSION DESIGN"
        title="Mission builder"
        description={
          editing
            ? 'Edit a saved configuration. Existing runs keep their snapshots.'
            : cloneId
              ? 'Clone into an unsaved draft with fresh identities.'
              : 'Design a fictional Communications Recovery mission.'
        }
      />
      <ErrorNotice
        error={registry.error ?? mission.error}
        retry={() => {
          void registry.refetch()
          if (missionId || cloneId) void mission.refetch()
        }}
      />
      {registry.isPending || ((missionId || cloneId) && mission.isPending) ? (
        <Loading />
      ) : (
        registry.data &&
        (!(missionId || cloneId) || mission.data) && (
          <BuilderEditor
            key={missionId || cloneId || 'new'}
            source={mission.data ?? blank}
            registry={registry.data}
            cloning={Boolean(cloneId)}
            editing={editing}
          />
        )
      )}
    </div>
  )
}
function BuilderEditor({
  source,
  registry,
  cloning,
  editing,
}: {
  source: MissionConfiguration
  registry: Registry
  cloning: boolean
  editing: boolean
}) {
  const client = useQueryClient(),
    navigate = useNavigate()
  const [initial] = useState(() => (cloning ? cloneMission(source) : source))
  return (
    <MissionForm
      initial={initial}
      registry={registry}
      editing={editing}
      onSave={async (configuration) => {
        const saved = await api.saveMission(configuration, editing)
        await invalidateMission(client, saved.id)
        return saved
      }}
      afterSave={(saved) =>
        navigate(`/mission-builder/${saved.id}`, { replace: true })
      }
    />
  )
}
