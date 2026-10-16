import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import Overview from '../pages/Overview'
import Files from '../pages/Files'
import People from '../pages/People'
import DashboardDesign from '../pages/DashboardDesign'
import Activity from '../pages/Activity'
import Settings from '../pages/Settings'
import FileViewer from '../pages/FileViewer'

const links: [string, string][] = [
  ['/', 'Overview'],
  ['/files', 'Files'],
  ['/people', 'People & Access'],
  ['/design', 'Dashboard Design'],
  ['/activity', 'Activity'],
  ['/settings', 'Settings']
]

export default function OwnerLayout() {
  const { signOut } = useAuth()
  const [s] = useSettings()
  return (
    <div className="owner-shell">
      <nav className="sidebar">
        <div className="brand">{s.title}</div>
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {label}
          </NavLink>
        ))}
        <div className="spacer" />
        <a
          href="#/"
          onClick={(e) => {
            e.preventDefault()
            signOut()
          }}
        >
          Sign out
        </a>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/files" element={<Files />} />
          <Route path="/file/:id" element={<FileViewer />} />
          <Route path="/people" element={<People />} />
          <Route path="/design" element={<DashboardDesign />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
