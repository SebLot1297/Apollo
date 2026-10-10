import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ChevronRight,
  FileChartColumn,
  Grid2X2,
  Menu,
  Radio,
  Settings2,
  Shield,
  SlidersHorizontal,
  Target,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router-dom'
import { Badge } from '../ui/Primitives'
import NotificationToast from '../ui/NotificationToast'
import { useRun, useRuns, terminalQueries } from '../../services/queries'
import { useRunStream } from '../../services/stream'
import { useWorkspace } from '../../store/workspace'
import { isTerminal } from '../../types/mission'
import { elapsed } from '../../utils/format'
const navigation = [
  { to: '/', label: 'Dashboard', icon: Grid2X2 },
  { to: '/mission-builder', label: 'Mission Builder', icon: SlidersHorizontal },
  { to: '/objectives', label: 'Objective Designer', icon: Target },
  { to: '/mission-control', label: 'Mission Control', icon: Radio },
  { to: '/reports', label: 'After-Action Reports', icon: FileChartColumn },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]
export default function AppLayout() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const client = useQueryClient()
  const runs = useRuns(client)
  const selected = useWorkspace((state) => state.selectedRunId)
  const routeRun = useMatch('/mission-control/:runId')?.params.runId
  const active = runs.data?.find((run) => !isTerminal(run.status))
  const runId = routeRun ?? active?.run_id ?? selected ?? ''
  const run = useRun(runId, client)
  const connection = useWorkspace(
    (state) => state.connections[runId] ?? 'connecting',
  )
  useRunStream(client, runId)
  useEffect(() => {
    if (routeRun) useWorkspace.getState().selectRun(routeRun)
  }, [routeRun])
  useEffect(() => {
    if (run.data && isTerminal(run.data.status)) terminalQueries(client, runId)
  }, [client, runId, run.data])
  const section =
    navigation.find((n) => n.to !== '/' && location.pathname.startsWith(n.to))
      ?.label ?? 'Dashboard'
  return (
    <div className="app-shell">
      <NotificationToast />
      {open && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <Link className="brand" to="/" onClick={() => setOpen(false)}>
          <span className="brand-mark">
            <Grid2X2 size={23} />
          </span>
          <span>
            COMMAND<span className="brand-light">GRID</span>
            <small>MISSION OPERATIONS PLATFORM</small>
          </span>
        </Link>
        <div className="nav-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'active' : ''}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-exercise">
          <div className="eyebrow">
            <Shield size={13} /> TRAINING ENVIRONMENT
          </div>
          <p>
            Prepare. Respond.
            <br />
            <strong>Keep the network alive.</strong>
          </p>
          <span className="mono">FICTIONAL OPERATIONS ONLY</span>
        </div>
        <div className="sidebar-bottom">
          <div className="workspace-avatar">CG</div>
          <div>
            <strong>Local workspace</strong>
            <small>Server-connected workspace</small>
          </div>
          <span className="live-dot" />
        </div>
        <div className="sidebar-version">
          <span>COMMANDGRID / V0.1</span>
          <span>OPERATIONS</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span className="muted">Workspace</span>
            <ChevronRight size={13} />
            <strong>{section}</strong>
          </div>
          <div className="topbar-right">
            <span className="top-mission">
              {run.data?.mission.name ?? 'No selected run'}
            </span>
            <Badge
              tone={
                run.data && ['running', 'completed'].includes(run.data.status)
                  ? 'green'
                  : run.data &&
                      ['failed', 'terminated'].includes(run.data.status)
                    ? 'red'
                    : 'neutral'
              }
            >
              {run.data?.status ?? 'Standby'}
            </Badge>
            <span className="mode-indicator">
              <Activity size={13} />{' '}
              {runId
                ? connection
                : runs.isError
                  ? 'Backend unavailable'
                  : 'No active run'}
            </span>
            <span className="top-clock mono">
              T+ {run.data ? elapsed(run.data.elapsed_time_seconds) : '—'}
            </span>
          </div>
        </header>
        <main id="main-content">
          <Outlet />
        </main>
        <footer className="global-footer">
          <span>
            <span className="live-dot" /> LOCAL WORKSPACE
          </span>
          <span>SYNTHETIC DATA · NONCOMBAT EXERCISE</span>
          <span>
            COMMANDGRID <strong>0.1.0</strong>
          </span>
        </footer>
      </div>
    </div>
  )
}
