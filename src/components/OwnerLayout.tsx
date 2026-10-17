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

const ownerLinks: [string, string][] = [
  ['/', 'Overview'],
  ['/files', 'Files'],
  ['/people', 'People & Access'],
  ['/design', 'Dashboard Design'],
  ['/activity', 'Activity'],
  ['/settings', 'Settings']
]

const editorLinks: [string, string][] = [
  ['/', 'Overview'],
  ['/files', 'Files'],
  ['/settings', 'Settings']
]

export default function OwnerLayout() {
  const { profile, signOut } = useAuth()
  const [s] = useSettings()
  const isOwner = profile?.role === 'owner'
  const links = isOwner ? ownerLinks : editorLinks

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
          <Route path="/settings" element={<Settings />} />
          {isOwner && <Route path="/people" element={<People />} />}
          {isOwner && <Route path="/design" element={<DashboardDesign />} />}
          {isOwner && <Route path="/activity" element={<Activity />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
