import { useState } from 'react'
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
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Badge } from '../ui/Primitives'
const navigation = [
  { to: '/', label: 'Dashboard', icon: Grid2X2 },
  { to: '/mission-builder', label: 'Mission Builder', icon: SlidersHorizontal },
  { to: '/mission-control', label: 'Mission Control', icon: Radio },
  { to: '/reports', label: 'After-Action Reports', icon: FileChartColumn },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]
export default function AppLayout() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const section =
    navigation.find((n) => n.to !== '/' && location.pathname.startsWith(n.to))
      ?.label ?? 'Dashboard'
  return (
    <div className="app-shell">
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
            <small>Foundation preview</small>
          </div>
          <span className="live-dot" />
        </div>
        <div className="sidebar-version">
          <span>COMMANDGRID / V0.1</span>
          <span>STARTER</span>
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
            <span className="top-mission">Operation Aurora</span>
            <Badge>Standby</Badge>
            <span className="mode-indicator">
              <Activity size={13} /> Demo workspace
            </span>
            <span className="top-clock mono">T+ 00:00:00</span>
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
