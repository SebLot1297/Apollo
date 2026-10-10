import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  FileChartColumn,
  FolderOpen,
  Radio,
  ShieldCheck,
  Target,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, PageHeading, PanelTitle } from '../components/ui/Primitives'
import ScenarioMap from '../components/dashboard/ScenarioMap'
import { demoMission as mission } from '../data/demoMission'
import { localDate } from '../utils/format'
const stats = [
  {
    label: 'DEMO MISSIONS',
    value: '01',
    detail: 'One fictional scenario to explore',
    icon: FolderOpen,
  },
  {
    label: 'COMPLETED SIMULATIONS',
    value: '00',
    detail: 'Execution planned for a later phase',
    icon: ShieldCheck,
  },
  {
    label: 'ACTIVE SIMULATION',
    value: '00',
    detail: 'Workspace on standby',
    icon: Radio,
  },
  {
    label: 'LAST MISSION RESULT',
    value: '—',
    detail: 'No completed exercises yet',
    icon: FileChartColumn,
  },
]
export default function Dashboard() {
  return (
    <div className="page dashboard-page">
      <PageHeading
        eyebrow="OPERATIONS OVERVIEW"
        title="Command dashboard"
        description="Your missions. Your objectives. Your command."
      >
        <Badge tone="cyan">FOUNDATION PREVIEW</Badge>
      </PageHeading>
      <div className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-label">
              {stat.label}
              <stat.icon size={17} />
            </div>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-detail">{stat.detail}</div>
          </div>
        ))}
      </div>
      <div className="dashboard-middle">
        <section className="panel operation-preview">
          <PanelTitle
            icon={Activity}
            title="Demonstration scenario"
            meta={<Badge tone="cyan">PREVIEW</Badge>}
          />
          <div className="preview-mission">
            <div>
              <div className="eyebrow">COMMUNICATIONS RECOVERY / NH–04</div>
              <h2>{mission.name}</h2>
              <p>{mission.description}</p>
            </div>
            <Link className="button" to="/mission-builder">
              Mission Builder
              <ArrowUpRight size={15} />
            </Link>
          </div>
          <ScenarioMap />
          <div className="preview-bottom">
            <span>
              <Target size={14} />
              {mission.objectives.length} sample objectives
            </span>
            <span>
              <Clock3 size={14} />
              {mission.durationHours}h mission window
            </span>
            <span className="mono">SCENARIO PREVIEW</span>
          </div>
        </section>
        <section className="panel readiness-panel">
          <PanelTitle title="Workspace foundation" meta="PHASE 01" />
          <div className="readiness-graphic">
            <div className="readiness-ring">
              <ShieldCheck size={38} />
            </div>
            <span className="eyebrow">FOUNDATION ESTABLISHED</span>
            <h3>Prepare to command.</h3>
            <p>
              Explore the workspace. Mission configuration and simulation will
              follow in the next phases.
            </p>
          </div>
          <Link className="quick-action" to="/mission-builder">
            <span className="quick-icon">
              <Target size={17} />
            </span>
            <span>
              <strong>Mission Builder</strong>
              <small>Next: configuration & objectives</small>
            </span>
            <ArrowRight size={17} />
          </Link>
          <Link className="quick-action" to="/settings">
            <span className="quick-icon">
              <FileChartColumn size={17} />
            </span>
            <span>
              <strong>View project roadmap</strong>
              <small>See what comes next</small>
            </span>
            <ArrowRight size={17} />
          </Link>
        </section>
      </div>
      <section className="mission-library">
        <div className="section-heading">
          <div>
            <h2>
              Mission library <span className="count-chip">01</span>
            </h2>
            <p>A fictional starting point for your future exercises.</p>
          </div>
          <Badge>DEMO CONFIGURATION</Badge>
        </div>
        <div className="mission-cards">
          <article className="mission-card">
            <div className="mission-card-top">
              <span className="mission-glyph">
                <Radio size={22} />
              </span>
              <Badge tone="cyan">SAMPLE MISSION</Badge>
            </div>
            <span className="eyebrow">MISSION 001</span>
            <h3>{mission.name}</h3>
            <p>{mission.category}</p>
            <div className="mission-card-meta">
              <span>
                <Target size={13} />
                {mission.objectives.length} objectives
              </span>
              <span>
                <Clock3 size={13} />
                {mission.durationHours}h
              </span>
            </div>
            <div className="mission-card-footer">
              <span>Seeded {localDate(mission.modifiedAt)}</span>
              <Link
                className="icon-button"
                aria-label="View Mission Builder"
                to="/mission-builder"
              >
                <ArrowUpRight size={18} />
              </Link>
            </div>
          </article>
          <div className="new-mission-card planned-card">
            <span>
              <Target size={23} />
            </span>
            <strong>Your next mission starts here.</strong>
            <small>Mission creation is planned for Phase 02.</small>
          </div>
        </div>
      </section>
      <div className="dashboard-bottom">
        <section className="panel">
          <PanelTitle title="Recent activity" meta="WORKSPACE SETUP" />
          <div className="foundation-activity">
            <span className="live-dot" />
            <div>
              <strong>CommandGrid workspace initialized</strong>
              <small>
                Project setup, navigation, and the initial dashboard are in
                place.
              </small>
            </div>
            <Badge tone="green">READY</Badge>
          </div>
        </section>
        <section className="panel">
          <PanelTitle title="Recent exercises" meta="00 COMPLETED" />
          <div className="recent-empty">
            <FileChartColumn size={24} />
            <span>
              No completed exercises yet.
              <small>Results will appear once simulation is implemented.</small>
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}
