
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { NotifProvider, useNotifs } from '../lib/notifications'
import { useLocalUpdates } from '../lib/offline'
import { Avatar, Icon, ThemeButton } from './Nav'
import EmployeeHome from '../pages/EmployeeHome'
import EmployeeFiles from '../pages/EmployeeFiles'
import FileViewer from '../pages/FileViewer'
import MySchedule from '../pages/MySchedule'
import Profile from '../pages/Profile'
import Notifications from '../pages/Notifications'
import Settings from '../pages/Settings'
import Tally from '../pages/Tally'
import './tabs.css'

const tabs: [string, string, string, string][] = [
  ['/', 'Home', 'Home', 'home'],
  ['/tally', 'Tally', 'Installation Tally', 'tally'],
  ['/files', 'Files', 'Files & resources', 'files'],
  ['/schedule', 'Schedule', 'My schedule', 'schedule'],
  ['/notifications', 'Alerts', 'Notifications', 'bell'],
  ['/profile', 'Profile', 'My ID card', 'user']
]

function TabBar({ title }: { title: string }) {
  const { unread: serverUnread } = useNotifs()
  const { profile, signOut } = useAuth()\n  const navigate = useNavigate()
  const local = useLocalUpdates(profile?.id)
  const unread = serverUnread + local.unread

  return (
    <nav className="tabbar" aria-label="Employee navigation">
      <div className="rail-brand">
        <span className="emp-brand-mark">A</span>
        <span>{title || 'AHBA Workspace'}</span>
      </div>

      {tabs.map(([to, short, full, icon]) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          aria-label={full}
          className={({ isActive }) => `emp-tab${isActive ? ' active' : ''}`}
        >
          <span className="ico">
            <Icon name={icon} />
            {to === '/notifications' && unread > 0 && (
              <b className="dot-badge">{unread > 99 ? '99+' : unread}</b>
            )}
          </span>
          <span className="lbl lbl-short">{short}</span>
          <span className="lbl lbl-full">{full}</span>
        </NavLink>
      ))}

      <button
        type="button"
        className="emp-tab emp-tab-logout"
        onClick={async () => { await signOut(); navigate('/', { replace: true }) }}
        aria-label="Log out"
        title="Log out"
      >
        <span className="ico"><Icon name="out" /></span>
        <span className="lbl lbl-short">Logout</span>
        <span className="lbl lbl-full">Log out</span>
      </button>
    </nav>
  )
}

export default function EmployeeLayout() {
  const { profile } = useAuth()
  const [settings] = useSettings()

  return (
    <NotifProvider>
      <div className="emp-app">
        <TabBar title={settings.title} />

        <main className="emp-main">
          <header className="emp-top">
            <div className="emp-top-copy">
              <span className="emp-eyebrow">AHBA DEVELOPMENT</span>
              <strong>{settings.title || 'Shared Workspace'}</strong>
            </div>
            <div className="emp-top-actions">
              <span className="emp-online"><i /> Workspace</span>
              <ThemeButton />
              <Avatar name={profile?.full_name} email={profile?.email} />
            </div>
          </header>

          <Routes>
            <Route path="/" element={<EmployeeHome settings={settings} />} />
            <Route path="/tally" element={<Tally />} />
            <Route path="/files" element={<EmployeeFiles settings={settings} />} />
            <Route path="/file/:id" element={<FileViewer />} />
            <Route path="/schedule" element={<MySchedule />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          <footer className="emp-footer">
            <span>AHBA Development</span>
            <span>Shared Workspace · Employee Portal</span>
          </footer>
        </main>
      </div>
    </NotifProvider>
  )
}
