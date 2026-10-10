import { Code2, GitBranch, Layers, Settings2 } from 'lucide-react'
import { Badge, PageHeading, PanelTitle } from '../components/ui/Primitives'
const phases = [
  {
    number: '01',
    title: 'Foundation',
    detail: 'Project setup, design system, navigation, and starter dashboard.',
    current: true,
  },
  {
    number: '02',
    title: 'Mission configuration',
    detail:
      'Mission Builder, parameters, custom objectives, and local persistence.',
  },
  {
    number: '03',
    title: 'Mission control',
    detail:
      'Interactive map, telemetry, incident response, and deterministic demo.',
  },
  {
    number: '04',
    title: 'Mission results',
    detail:
      'Objective evaluation, after-action reports, and performance charts.',
  },
]
export default function Settings() {
  return (
    <div className="page settings-page">
      <PageHeading
        eyebrow="PROJECT FOUNDATION"
        title="Workspace settings"
        description="Initial setup is ready. Advanced preferences come later."
      >
        <Badge>STARTER</Badge>
      </PageHeading>
      <div className="settings-grid">
        <section className="panel">
          <PanelTitle title="Project setup" icon={Code2} />
          <dl className="settings-list">
            <div>
              <dt>Framework</dt>
              <dd>React + TypeScript</dd>
            </div>
            <div>
              <dt>Build tool</dt>
              <dd>Vite</dd>
            </div>
            <div>
              <dt>Styles & icons</dt>
              <dd>Tailwind CSS + Lucide</dd>
            </div>
            <div>
              <dt>Navigation</dt>
              <dd>React Router</dd>
            </div>
            <div>
              <dt>Backend connection</dt>
              <dd>
                <Badge>Not configured</Badge>
              </dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <PanelTitle title="Repository" icon={GitBranch} />
          <div className="settings-content">
            <span className="eyebrow">APOLLO / COMMANDGRID</span>
            <h3 className="repo-title">A clean starting point.</h3>
            <p>
              Source is organized into pages, reusable layout components, UI
              primitives, typed mission models, and fictional demo data.
            </p>
            <a
              className="button repo-link"
              href="https://github.com/SebLot1297/Apollo"
              target="_blank"
              rel="noreferrer"
            >
              <GitBranch size={15} />
              Open GitHub repository
            </a>
          </div>
        </section>
        <section className="panel settings-future">
          <PanelTitle
            title="Implementation roadmap"
            icon={Layers}
            meta="CURRENT SCOPE: FOUNDATION"
          />
          <ol className="roadmap">
            {phases.map((phase) => (
              <li key={phase.number}>
                <span
                  className={`roadmap-number ${phase.current ? 'cyan' : ''}`}
                >
                  {phase.number}
                </span>
                <div>
                  <h3>{phase.title}</h3>
                  <p>{phase.detail}</p>
                </div>
                <Badge tone={phase.current ? 'green' : 'neutral'}>
                  {phase.current ? 'CURRENT' : 'LATER'}
                </Badge>
              </li>
            ))}
          </ol>
        </section>
        <section className="panel settings-future">
          <PanelTitle title="Preferences" icon={Settings2} />
          <p className="panel-empty">
            Theme controls and workspace personalization will be added in a
            later phase.
          </p>
        </section>
      </div>
    </div>
  )
}
