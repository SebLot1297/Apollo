import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Menu, Settings2, X } from 'lucide-react'
import { Link, NavLink, Outlet, useMatch } from 'react-router-dom'
import NotificationToast from '../ui/NotificationToast'
import { useRun, useRuns, terminalQueries } from '../../services/queries'
import { useRunStream } from '../../services/stream'
import { useWorkspace } from '../../store/workspace'
import { isTerminal } from '../../types/mission'

const navigation = [
  { to: '/', label: 'Dashboard' },
  { to: '/mission-builder', label: 'Mission Builder' },
  { to: '/objectives', label: 'Objectives' },
  { to: '/mission-control', label: 'Mission Control' },
  { to: '/reports', label: 'Reports' },
]
export default function AppLayout() {
  const [open, setOpen] = useState(false),
    menu = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLDivElement>(null),
    client = useQueryClient()
  const runs = useRuns(client),
    selected = useWorkspace((state) => state.selectedRunId)
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
  useEffect(() => {
    if (open) drawer.current?.querySelector<HTMLElement>('button, a')?.focus()
  }, [open])
  const close = () => {
    setOpen(false)
    menu.current?.focus()
  }
  const links = navigation.map(({ to, label }) => (
    <NavLink
      key={to}
      to={to}
      end={to === '/'}
      onClick={() => setOpen(false)}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      {label}
    </NavLink>
  ))
  return (
    <div className="app-shell">
      <NotificationToast />
      <header className="atlas-header" data-testid="atlas-header">
        <Link className="brand" to="/">
          CommandGrid
        </Link>
        <nav className="desktop-navigation" aria-label="Main navigation">
          {links}
          <div className="header-utilities">
            <span
              className={`connection-label ${connection === 'live' ? 'is-live' : ''}`}
            >
              <i />
              {runId
                ? connection
                : runs.isError
                  ? 'Backend unavailable'
                  : 'Standby'}
            </span>
            <NavLink
              to="/settings"
              className="icon-button"
              aria-label="Settings"
            >
              <Settings2 size={18} />
            </NavLink>
            <span className="workspace-label">Local workspace</span>
          </div>
        </nav>
        <button
          ref={menu}
          className="icon-button mobile-menu"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setOpen(true)}
        >
          <Menu size={22} />
        </button>
      </header>
      {open && (
        <div className="nav-overlay" onClick={close}>
          <div
            id="mobile-navigation"
            className="mobile-drawer"
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
              if (e.key !== 'Tab') return
              const focusable = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>('a, button'),
              )
              const first = focusable[0],
                last = focusable.at(-1)
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault()
                last?.focus()
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault()
                first?.focus()
              }
            }}
          >
            <div className="drawer-heading">
              <strong>CommandGrid</strong>
              <button
                className="icon-button"
                aria-label="Close navigation"
                onClick={close}
              >
                <X size={20} />
              </button>
            </div>
            <nav aria-label="Main navigation">
              {links}
              <NavLink
                className="nav-item"
                to="/settings"
                onClick={() => setOpen(false)}
              >
                Settings
              </NavLink>
            </nav>
            <p className="cg-help">
              Local workspace · {runId ? connection : 'Standby'}
            </p>
          </div>
        </div>
      )}
      <main id="main-content">
        <Outlet />
      </main>
      <footer className="global-footer">
        <span>CommandGrid · Local workspace</span>
        <span>Fictional infrastructure · Noncombat simulation</span>
      </footer>
    </div>
  )
}
