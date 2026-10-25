import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { NotifProvider, useNotifs } from '../lib/notifications'
import { Avatar, Icon, ThemeButton } from './Nav'
import EmployeeHome from '../pages/EmployeeHome'
import EmployeeFiles from '../pages/EmployeeFiles'
import FileViewer from '../pages/FileViewer'
import MySchedule from '../pages/MySchedule'
import Notifications from '../pages/Notifications'
import Settings from '../pages/Settings'
import './tabs.css'

const tabs: [string, string, string][] = [
  ['/', 'Home', 'home'],
  ['/files', 'Files', 'files'],
  ['/schedule', 'Schedule', 'schedule'],
  ['/notifications', 'Notifications', 'bell'],
  ['/settings', 'Profile', 'user']
]

function TabBar() {
  const { unread } = useNotifs()
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map(([to, label, icon]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">
            <Icon name={icon} />
            {to === '/notifications' && unread > 0 && (
              <b className="dot-badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</b>
            )}
          </span>
          <span className="lbl">{label}</span>
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
      <div className="employee-shell emp">
        <header className="emp-top">
          <strong>{s.title}</strong>
          <div className="row" style={{ gap: '0.4rem' }}>
            <ThemeButton />
            <Avatar name={profile?.full_name} email={profile?.email} />
          </div>
        </header>
        <Routes>
          <Route path="/" element={<EmployeeHome settings={s} />} />
          <Route path="/files" element={<EmployeeFiles settings={s} />} />
          <Route path="/file/:id" element={<FileViewer />} />
          <Route path="/schedule" element={<MySchedule />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <TabBar />
      </div>
    </NotifProvider>
  )
}
