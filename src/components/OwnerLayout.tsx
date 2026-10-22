import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { Avatar, Icon, ThemeButton } from './Nav'
import Overview from '../pages/Overview'
import Files from '../pages/Files'
import People from '../pages/People'
import DashboardDesign from '../pages/DashboardDesign'
import Activity from '../pages/Activity'
import Settings from '../pages/Settings'
import MySchedule from '../pages/MySchedule'
import FileViewer from '../pages/FileViewer'

const ownerLinks: [string, string, string][] = [
  ['/', 'Overview', 'home'],
  ['/files', 'Files', 'files'],
  ['/schedule', 'Schedule', 'schedule'],
  ['/people', 'People', 'people'],
  ['/design', 'Design', 'design'],
  ['/activity', 'Activity', 'activity'],
  ['/settings', 'Settings', 'settings']
]

const editorLinks: [string, string, string][] = [
  ['/', 'Overview', 'home'],
  ['/files', 'Files', 'files'],
  ['/schedule', 'Schedule', 'schedule'],
  ['/settings', 'Settings', 'settings']
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
        {links.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={icon} />
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="spacer" />
        <ThemeButton />
       <div className="side-foot">
          <div className="me">
          <Avatar name={profile?.full_name} email={profile?.email} />
          <span className="who"><b>{profile?.full_name || profile?.email}</b><i>{profile?.role}</i></span>
          </div>
          <ThemeButton />
            <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="out" /></button>
        </div>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/files" element={<Files />} />
          <Route path="/file/:id" element={<FileViewer />} />
          <Route path="/schedule" element={<MySchedule />} />
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
