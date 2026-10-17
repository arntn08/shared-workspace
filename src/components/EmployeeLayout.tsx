import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { Avatar, Icon, ThemeButton } from './Nav'
import EmployeeHome from '../pages/EmployeeHome'
import FileViewer from '../pages/FileViewer'
import Settings from '../pages/Settings'

export default function EmployeeLayout() {
  const { profile } = useAuth()
  const [s] = useSettings()
  return (
    <div className="employee-shell">
      <nav className="sidebar">
        <div className="brand">{s.title}</div>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="files" />
          <span>Files</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="settings" />
          <span>Settings</span>
        </NavLink>
        <div className="spacer" />
        <ThemeButton />
        <div className="me">
          <Avatar name={profile?.full_name} email={profile?.email} />
        </div>
      </nav>
      <div style={{ height: '1rem' }} />
      <Routes>
        <Route path="/" element={<EmployeeHome settings={s} />} />
        <Route path="/file/:id" element={<FileViewer />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
