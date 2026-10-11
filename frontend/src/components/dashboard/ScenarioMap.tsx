import { useState } from 'react'
import {
  Building2,
  Navigation,
  Radio,
  TriangleAlert,
  Users,
  Zap,
} from 'lucide-react'
import type {
  Facility,
  IncidentKind,
  PublicSystems,
  SupportTeam,
} from '../../types/mission'
import {
  facilitySystem,
  facilityType,
  healthTone,
  kindForFacility,
} from '../../features/control/presentation'
import { number } from '../../utils/format'

interface Props {
  facilities: Facility[]
  teams: SupportTeam[]
  systems?: PublicSystems
  variant?: 'compact' | 'full'
  selectedId?: string | null
  onSelect?: (id: string) => void
  incidentKind?: IncidentKind
}
export default function ScenarioMap({
  facilities,
  teams,
  systems,
  variant = 'compact',
  selectedId,
  onSelect,
  incidentKind,
}: Props) {
  const [localSelection, setLocalSelection] = useState<string | null>(null)
  const selected = selectedId === undefined ? localSelection : selectedId
  const markers = [
    ...facilities.map((f) => ({
      ...f,
      type: 'facility' as const,
      kind: f.kind,
    })),
    ...teams.map((t) => ({
      ...t,
      type: 'team' as const,
      kind: 'team' as const,
    })),
  ]
  const current = markers.find((m) => m.id === selected)
  // Fixed slots choose a collision-free label direction in normalized canvas units.
  const placed: { x: number; y: number; w: number; h: number }[] = []
  const labels = markers.map((marker) => {
    if (marker.type === 'team') return 'label-right'
    const candidates = [
      { name: 'label-right', x: marker.x + 3, y: marker.y - 5, w: 20, h: 11 },
      { name: 'label-left', x: marker.x - 23, y: marker.y - 5, w: 20, h: 11 },
      { name: 'label-below', x: marker.x - 10, y: marker.y + 5, w: 20, h: 11 },
      { name: 'label-above', x: marker.x - 10, y: marker.y - 16, w: 20, h: 11 },
    ]
    const candidate = candidates.find(
      (c) =>
        c.x >= 0 &&
        c.y >= 0 &&
        c.x + c.w <= 100 &&
        c.y + c.h <= 100 &&
        placed.every(
          (p) =>
            c.x + c.w <= p.x ||
            p.x + p.w <= c.x ||
            c.y + c.h <= p.y ||
            p.y + p.h <= c.y,
        ),
    )
    if (!candidate) return 'label-hidden'
    placed.push(candidate)
    return candidate.name
  })
  return (
    <div className={`atlas-map atlas-map-${variant}`}>
      <div
        className="map-canvas"
        role="group"
        aria-label="Fictional facility and support team map"
      >
        <img
          className="terrain-backplate"
          src="/assets/terrain-atlas.png"
          alt=""
        />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="map-links"
          aria-hidden="true"
        >
          {facilities.slice(1).map((f, i) => (
            <line
              key={f.id}
              x1={facilities[i].x}
              y1={facilities[i].y}
              x2={f.x}
              y2={f.y}
              className={
                f.status === 'operational'
                  ? 'link-operational'
                  : 'link-degraded'
              }
            />
          ))}
        </svg>
        <div className="atlas-map-legend">
          <span>
            <i className="legend-facility" /> Facility
          </span>
          <span>
            <i className="legend-team" /> Support team
          </span>
          <span>
            <i className="legend-line" /> Schematic link
          </span>
          <small>Fictional terrain</small>
        </div>
        <div className="atlas-map-compass" aria-hidden="true">
          N<Navigation size={24} fill="currentColor" />
        </div>
        <div className="atlas-map-scale">
          <span>0</span>
          <span>50</span>
          <span>100</span>
          <i />
          <small>Synthetic units</small>
        </div>
        <div className="map-plot">
          {markers.map((marker, index) => {
            const Icon =
              marker.kind === 'team'
                ? Users
                : marker.kind === 'power'
                  ? Zap
                  : marker.kind === 'relay'
                    ? Radio
                    : Building2
            const value =
              marker.type === 'facility' && systems
                ? systems[facilitySystem[marker.kind as Facility['kind']]]
                : null
            const tone =
              marker.status === 'offline'
                ? 'red'
                : marker.status === 'degraded'
                  ? 'amber'
                  : 'green'
            const associated =
              marker.type === 'facility' &&
              incidentKind &&
              kindForFacility[marker.kind as Facility['kind']] === incidentKind
            return (
              <button
                key={marker.id}
                className={`map-marker ${marker.type === 'team' ? 'marker-team' : ''} ${labels[index]} tone-${tone} ${selected === marker.id ? 'selected' : ''} ${associated ? 'associated' : ''}`}
                style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                aria-label={`${marker.name}: ${marker.status}, coordinates ${marker.x}, ${marker.y}`}
                aria-pressed={selected === marker.id}
                onClick={() => {
                  setLocalSelection(marker.id)
                  onSelect?.(marker.id)
                }}
              >
                <span className="marker-symbol">
                  {marker.status === 'degraded' ? (
                    <TriangleAlert size={24} />
                  ) : (
                    <Icon size={marker.type === 'team' ? 16 : 26} />
                  )}
                  <i />
                </span>
                <span className="marker-label">
                  <strong>{marker.name}</strong>
                  <small>
                    {marker.type === 'facility'
                      ? facilityType[marker.kind as Facility['kind']]
                      : 'Support team'}{' '}
                    · ({marker.x}, {marker.y})
                  </small>
                  <span className="marker-status">
                    {value !== null && (
                      <span className={`mini-meter tone-${healthTone(value)}`}>
                        <i style={{ width: `${value}%` }} />
                      </span>
                    )}
                    {marker.status}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="map-coordinate">
          Fictional terrain · Synthetic coordinates 0–100
        </div>
      </div>
      <p className="map-selection" aria-live="polite">
        {current
          ? `${current.name} · ${current.status} · coordinates (${current.x}, ${current.y})${current.type === 'facility' && systems ? ` · System health ${number(systems[facilitySystem[current.kind as Facility['kind']]], '%')}` : ''}`
          : 'Select a facility or support team to inspect its status.'}
      </p>
    </div>
  )
}
