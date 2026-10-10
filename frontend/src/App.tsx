import { lazy, Suspense, type ReactElement } from 'react'
import { createBrowserRouter, Link, RouterProvider } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import { Loading } from './components/ui/Feedback'
import { ConfirmProvider } from './components/ui/Confirm'
import './App.css'
import './workspace.css'
const Dashboard = lazy(() => import('./pages/Dashboard'))
const MissionBuilder = lazy(() => import('./pages/MissionBuilder'))
const ObjectiveDesigner = lazy(() => import('./pages/ObjectiveDesigner'))
const MissionControl = lazy(() => import('./pages/MissionControl'))
const AfterActionReport = lazy(() => import('./pages/AfterActionReport'))
const Settings = lazy(() => import('./pages/Settings'))
const page = (element: ReactElement) => (
  <Suspense
    fallback={
      <div className="page">
        <Loading />
      </div>
    }
  >
    {element}
  </Suspense>
)
const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: page(<Dashboard />) },
      { path: 'mission-builder', element: page(<MissionBuilder />) },
      { path: 'mission-builder/:missionId', element: page(<MissionBuilder />) },
      { path: 'objectives', element: page(<ObjectiveDesigner />) },
      { path: 'objectives/:missionId', element: page(<ObjectiveDesigner />) },
      { path: 'mission-control', element: page(<MissionControl />) },
      { path: 'mission-control/:runId', element: page(<MissionControl />) },
      { path: 'reports', element: page(<AfterActionReport />) },
      { path: 'reports/:runId', element: page(<AfterActionReport />) },
      { path: 'settings', element: page(<Settings />) },
      {
        path: '*',
        element: (
          <div className="page">
            <h1>Page not found</h1>
            <p>This route is unavailable.</p>
            <Link className="button" to="/">
              Return to dashboard
            </Link>
          </div>
        ),
      },
    ],
  },
])
export default function App() {
  return (
    <ConfirmProvider>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <RouterProvider router={router} />
    </ConfirmProvider>
  )
}
