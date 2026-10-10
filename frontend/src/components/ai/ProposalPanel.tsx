import { useState } from 'react'
import { z } from 'zod'
import type {
  AIEnvelope,
  MissionConfiguration,
  MissionObjective,
  Registry,
} from '../../types/mission'
import {
  missionSchema,
  objectiveSchema,
  serializeDraft,
  type MissionDraft,
} from '../../features/missions/validation'
import { useAI } from './useAI'
import Availability from './Availability'
import Provenance from './Provenance'
import { ErrorNotice } from '../ui/Feedback'

export default function ProposalPanel({
  mission,
  registry,
  savedMission,
  onApply,
  objectivesOnly = false,
}: {
  mission: MissionDraft
  registry: Registry
  savedMission: boolean
  onApply: (mission: MissionConfiguration) => void
  objectivesOnly?: boolean
}) {
  const ai = useAI(),
    [prompt, setPrompt] = useState(''),
    [proposal, setProposal] = useState<AIEnvelope<unknown> | null>(null)
  const [text, setText] = useState(''),
    [kind, setKind] = useState<'mission' | 'objectives'>('mission')
  const [selected, setSelected] = useState<Set<number>>(new Set()),
    [reviewError, setReviewError] = useState<unknown>(null)
  const canGenerate =
    ai.available &&
    !ai.pending &&
    !ai.cooldown &&
    Boolean(prompt.trim()) &&
    prompt.length <= 8000
  const generate = async (nextKind: 'mission' | 'objectives') => {
    setReviewError(null)
    const context = `\nUnsaved mission context: ${JSON.stringify({ name: mission.name, duration_seconds: mission.duration_seconds, parameters: mission.parameters, objectives: mission.objectives.map(({ metric_key, operator, target_value, required, evaluation_mode, deadline_seconds }) => ({ metric_key, operator, target_value, required, evaluation_mode, deadline_seconds })) })}`
    const requestPrompt =
      nextKind === 'objectives' && !savedMission ? prompt + context : prompt
    if (requestPrompt.length > 8000) {
      setReviewError(
        new Error(
          'Prompt plus unsaved mission context exceeds 8000 characters. Shorten the prompt or save the mission before generating objectives.',
        ),
      )
      return
    }
    const response = await ai.execute<unknown>(
      nextKind === 'mission' ? 'generate-mission' : 'generate-objectives',
      {
        prompt: requestPrompt,
        ...(nextKind === 'objectives' && savedMission
          ? { mission_id: mission.id }
          : {}),
      },
    )
    if (response) {
      setProposal(response)
      setKind(nextKind)
      setText(JSON.stringify(response.data, null, 2))
      setSelected(new Set())
    }
  }
  let suggestions: MissionObjective[] = []
  if (kind === 'objectives') {
    try {
      suggestions = z.array(objectiveSchema).parse(JSON.parse(text))
    } catch {
      /* Explicit Apply reports editable JSON errors. */
    }
  }
  const apply = (replace = false) => {
    try {
      const base = serializeDraft(mission)
      let merged: MissionConfiguration
      if (kind === 'mission') {
        const generated = missionSchema(registry).parse(JSON.parse(text))
        merged = {
          ...generated,
          id: savedMission ? base.id : crypto.randomUUID(),
          created_at: savedMission ? base.created_at : new Date().toISOString(),
          updated_at: base.updated_at,
          facilities: savedMission ? base.facilities : [],
          support_teams: [],
          objectives: generated.objectives.map((o, index) => ({
            ...o,
            id:
              savedMission && base.objectives[index]
                ? base.objectives[index].id
                : crypto.randomUUID(),
          })),
        }
      } else {
        if (!selected.size)
          throw new Error('Select at least one objective suggestion.')
        const chosen = z
          .array(objectiveSchema)
          .parse(JSON.parse(text))
          .filter((_, index) => selected.has(index))
          .map((o) => ({ ...o, id: crypto.randomUUID() }))
        merged = {
          ...base,
          objectives: replace ? chosen : [...base.objectives, ...chosen],
          support_teams:
            base.parameters.team_count === mission.support_teams.length
              ? base.support_teams
              : [],
        }
      }
      const validated = missionSchema(registry).parse(merged)
      onApply(validated)
      setProposal(null)
      setReviewError(null)
    } catch (failure) {
      setReviewError(
        failure instanceof z.ZodError
          ? new Error(
              failure.issues
                .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                .join('; '),
            )
          : failure,
      )
    }
  }
  return (
    <div className="cg-ai-panel">
      <h2 className="cg-section-title">AI-assisted proposals</h2>
      <p className="cg-help">
        Generate only on request. Review, edit, and explicitly Apply to this
        draft, then separately Save. AI cannot launch runs or change numerical
        results.
      </p>
      <Availability ai={ai} />
      <label className="cg-field">
        <span>Proposal prompt</span>
        <textarea
          aria-label="Proposal prompt"
          value={prompt}
          maxLength={8000}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <small>
          {prompt.length}/8000 characters. Unsaved objective requests include
          bounded draft context.
        </small>
      </label>
      <div className="cg-actions">
        {!objectivesOnly && (
          <button
            className="button"
            type="button"
            disabled={!canGenerate}
            onClick={() => void generate('mission')}
          >
            Generate mission proposal
          </button>
        )}
        <button
          className="button"
          type="button"
          disabled={!canGenerate}
          onClick={() => void generate('objectives')}
        >
          Generate objective proposals
        </button>
      </div>
      {ai.pending && <p role="status">Generating proposal…</p>}
      <ErrorNotice error={reviewError} />
      {proposal && (
        <section className="cg-stack" aria-label="Proposal review">
          <h3>Review proposed {kind}</h3>
          <Provenance envelope={proposal} />
          <label className="cg-field">
            <span>Proposal JSON</span>
            <textarea
              aria-label="Proposal JSON"
              className="mono"
              rows={12}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {kind === 'objectives' &&
            suggestions.map((o, index) => (
              <label className="cg-check" key={index}>
                <input
                  type="checkbox"
                  checked={selected.has(index)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(index)
                      else next.delete(index)
                      return next
                    })
                  }
                />
                Select suggestion {index + 1}: {o.name}
              </label>
            ))}
          <div className="cg-actions">
            <button
              className="button"
              type="button"
              onClick={() => {
                setProposal(null)
                setReviewError(null)
              }}
            >
              Discard proposal
            </button>
            <button
              className="button primary"
              type="button"
              disabled={kind === 'objectives' && !selected.size}
              onClick={() => apply(false)}
            >
              {kind === 'mission'
                ? 'Apply proposal to draft'
                : 'Append selected objectives'}
            </button>
            {kind === 'objectives' && (
              <button
                className="button warning"
                type="button"
                disabled={!selected.size}
                onClick={() => apply(true)}
              >
                Replace with selected objectives
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
