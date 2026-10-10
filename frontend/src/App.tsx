import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import Dashboard from './pages/Dashboard'
import MissionBuilder from './pages/MissionBuilder'
import MissionControl from './pages/MissionControl'
import AfterActionReport from './pages/AfterActionReport'
import Settings from './pages/Settings'
import './App.css'
export default function App() {
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="mission-builder/*" element={<MissionBuilder />} />
          <Route path="mission-control" element={<MissionControl />} />
          <Route path="reports/*" element={<AfterActionReport />} />
          <Route path="settings" element={<Settings />} />
          <Route
            path="*"
            element={
              <div className="page">
                <h1>Page not found</h1>
                <p>This route is unavailable.</p>
                <Link className="button" to="/">
                  Return to dashboard
                </Link>
              </div>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
