import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
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

// [path, short label (phones), full label (desktop), icon]
const tabs: [string, string, string, string][] = [
  ['/', 'Home', 'Home', 'home'],
  ['/tally', 'Tally', 'Installation Tally', 'tally'],
  ['/files', 'Files', 'Files', 'files'],
  ['/schedule', 'Schedule', 'Schedule', 'schedule'],
  ['/notifications', 'Alerts', 'Notifications', 'bell'],
  ['/profile', 'Profile', 'Profile', 'user']
]

function TabBar({ title }: { title: string }) {
  const { unread: serverUnread } = useNotifs()
  const { profile } = useAuth()
  const local = useLocalUpdates(profile?.id)
  const unread = serverUnread + local.unread
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="rail-brand">{title}</div>
      {tabs.map(([to, short, full, icon]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')} aria-label={full}>
          <span className="ico">
            <Icon name={icon} />
            {to === '/notifications' && unread > 0 && (
              <b className="dot-badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</b>
            )}
          </span>
          <span className="lbl lbl-short">{short}</span>
          <span className="lbl lbl-full">{full}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export default function EmployeeLayout() {
  const { profile } = useAuth()
  const [s] = useSettings()
  return (
    <NotifProvider>
      <div className="emp-app">
        <TabBar title={s.title} />
        <div className="emp-main">
          <header className="emp-top">
            <strong>{s.title}</strong>
            <div className="row" style={{ gap: '0.4rem' }}>
              <ThemeButton />
              <Avatar name={profile?.full_name} email={profile?.email} />
            </div>
          </header>
          <Routes>
            <Route path="/" element={<EmployeeHome settings={s} />} />
            <Route path="/tally" element={<Tally />} />
            <Route path="/files" element={<EmployeeFiles settings={s} />} />
            <Route path="/file/:id" element={<FileViewer />} />
            <Route path="/schedule" element={<MySchedule />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </NotifProvider>
  )
}
