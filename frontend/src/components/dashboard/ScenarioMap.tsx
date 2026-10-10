import { useId, useState } from 'react'
import { Building2, Radio, Users, Zap } from 'lucide-react'
import type { Facility, SupportTeam } from '../../types/mission'
export default function ScenarioMap({
  facilities,
  teams,
}: {
  facilities: Facility[]
  teams: SupportTeam[]
}) {
  const gridId = useId(),
    [selected, setSelected] = useState<string | null>(null)
  const markers = [
    ...facilities.map((f) => ({
      ...f,
      type: 'facility',
      icon: f.kind === 'relay' ? Radio : f.kind === 'power' ? Zap : Building2,
    })),
    ...teams.map((team) => ({ ...team, type: 'team', icon: Users })),
  ]
  const current = markers.find((marker) => marker.id === selected)
  return (
    <>
      <div
        className="operational-map map-compact cg-map"
        role="group"
        aria-label="Fictional facility and support team map"
      >
        <svg
          className="terrain"
          viewBox="0 0 800 480"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <pattern
              id={gridId}
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M40 0H0V40"
                fill="none"
                stroke="#264342"
                strokeWidth=".7"
              />
            </pattern>
          </defs>
          <rect width="800" height="480" fill={`url(#${gridId})`} />
          <g fill="none" stroke="#294844" strokeWidth="1.5" opacity=".6">
            <path d="M-30 330C70 210 96 365 160 228S250 178 280 80 364-10 403-50M-30 350C75 245 120 390 180 240S273 185 302 86 380 5 430-30M-20 377C75 270 151 405 202 270S300 190 326 104 420 35 452-20M480 520C385 420 521 370 489 280S538 203 613 120 667 60 820 58M515 520C433 430 557 364 520 278S567 214 640 137 699 90 820 84M540 515C464 430 591 360 552 278S600 233 663 153 722 127 823 111" />
          </g>
          <path
            d="M0 440C183 303 198 383 325 319S442 273 499 179 620 192 800 5"
            fill="none"
            stroke="#25464c"
            strokeWidth="20"
            opacity=".6"
          />
        </svg>
        <div className="map-coordinate coord-top mono">
          FICTIONAL TERRAIN · SYNTHETIC COORDINATES 0–100
        </div>
        <div className="map-plot">
          {markers.map(({ id, name, x, y, status, type, icon: Icon }) => (
            <button
              key={id}
              className={`map-marker ${type === 'team' ? 'marker-team' : ''} ${status === 'offline' ? 'marker-critical' : status === 'degraded' ? 'marker-alert' : ''} ${id === selected ? 'selected' : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              aria-label={`${name}: ${status}, coordinates ${x}, ${y}`}
              aria-pressed={id === selected}
              onClick={() => setSelected(id)}
            >
              <span className="marker-symbol">
                <Icon size={type === 'team' ? 12 : 15} />
              </span>
              <span className="marker-label">{name}</span>
            </button>
          ))}
        </div>
        <div className="map-legend">
          <span>
            <i className="legend-square" />
            Facility
          </span>
          <span>
            <i className="legend-circle" />
            Support team
          </span>
          <span>Green: operational · Amber: degraded · Red: offline</span>
          <span>Positions from saved/server state</span>
        </div>
      </div>
      <div className="cg-map-selection" aria-live="polite">
        {current
          ? `${current.name} · ${current.status} · coordinates (${current.x}, ${current.y})`
          : 'Select a facility or team with mouse or keyboard to inspect its actual coordinates and status.'}
      </div>
    </>
  )
}
