import { Building2, Radio, Users, Zap } from 'lucide-react'
const markers = [
  { name: 'North Haven', x: 24, y: 25, icon: Building2 },
  { name: 'Relay Station 04', x: 56, y: 35, icon: Radio },
  { name: 'Meridian Relief Hub', x: 73, y: 66, icon: Building2 },
  { name: 'Eastbank Power', x: 30, y: 75, icon: Zap },
]
export default function ScenarioMap() {
  return (
    <div
      className="operational-map map-compact"
      role="img"
      aria-label="Fictional North Haven district: facilities connected to Relay Station 04, with four support teams."
    >
      <svg
        className="terrain"
        viewBox="0 0 800 480"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="grid"
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
        <rect width="800" height="480" fill="url(#grid)" />
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
        <path
          d="M192 115L448 168 576 326 240 365 192 115M448 168L240 365"
          fill="none"
          stroke="#497d72"
          strokeWidth="1.2"
          strokeDasharray="5 7"
        />
        <text
          x="35"
          y="30"
          fill="#57766e"
          fontSize="10"
          fontFamily="monospace"
          letterSpacing="3"
        >
          NORTH HAVEN DISTRICT
        </text>
      </svg>
      <div className="map-coordinate coord-top mono">
        SCENARIO PREVIEW / FICTIONAL TERRAIN
      </div>
      {markers.map(({ name, x, y, icon: Icon }) => (
        <div
          key={name}
          className="map-marker"
          style={{ left: `${x}%`, top: `${y}%` }}
        >
          <span className="marker-symbol">
            <Icon size={15} />
          </span>
          <span className="marker-label">{name}</span>
        </div>
      ))}
      {[22, 35, 48, 61].map((x, i) => (
        <div
          key={x}
          className="map-marker marker-team"
          style={{ left: `${x}%`, top: '48%' }}
        >
          <span className="marker-symbol">
            <Users size={10} />
          </span>
          <span className="marker-label">Support 0{i + 1}</span>
        </div>
      ))}
      <div className="map-legend">
        <span>
          <i className="legend-square" />
          Facility
        </span>
        <span>
          <i className="legend-circle" />
          Support team
        </span>
        <span>
          <i className="legend-line" />
          Comms link
        </span>
        <span className="map-preview-label">STATIC PREVIEW</span>
      </div>
    </div>
  )
}
