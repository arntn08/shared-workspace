import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { Avatar, Icon, ThemeButton } from './Nav'
import MySchedule from '../pages/MySchedule'
import HrNtes from '../pages/HrNtes'
import Settings from '../pages/Settings'
import EmployeeFiles from '../pages/EmployeeFiles'
import FileViewer from '../pages/FileViewer'

const links = [
  ['/','HR overview','home'],
  ['/schedule','Team schedules','schedule'],
  ['/ntes','Notices to Explain','file-text'],
  ['/files','Files & resources','files'],
  ['/settings','Settings','settings']
] as const

export default function HrLayout() {
  const { profile, signOut } = useAuth()
  const [settings] = useSettings()
  const location = useLocation()
  const navigate = useNavigate()
  const current = links.find(([to]) => to === '/' ? location.pathname === '/' : location.pathname.startsWith(to))?.[1] ?? 'HR portal'

  return <div className="ops-shell employee-ops-shell">
    <aside className="ops-sidebar">
      <div className="ops-brand"><div className="ops-brand-mark">A</div><div className="ops-brand-copy"><strong>AHBA</strong><span>{settings.title || 'Development Workspace'}</span></div></div>
      <div className="ops-workspace-label">HR PORTAL</div>
      <nav className="ops-nav" aria-label="HR navigation">
        <div className="ops-nav-group"><div className="ops-nav-heading">People operations</div>
          {links.map(([to,label,icon]) => <NavLink key={to} to={to} end={to === '/'} className={({isActive}) => `ops-nav-link${isActive ? ' active' : ''}`}><span className="ops-nav-icon"><Icon name={icon} /></span><span className="ops-nav-label">{label}</span></NavLink>)}
        </div>
      </nav>
      <div className="ops-sidebar-bottom"><div className="ops-help-card"><span className="ops-help-icon">✦</span><div><strong>Restricted access</strong><span>HR permissions</span></div></div>
        <div className="ops-profile"><Avatar name={profile?.full_name} email={profile?.email}/><div className="ops-profile-copy"><strong>{profile?.full_name || profile?.email}</strong><span>HR</span></div><ThemeButton/><button className="ops-icon-button" onClick={async()=>{await signOut();navigate('/',{replace:true})}} title="Sign out" aria-label="Sign out"><Icon name="out"/></button></div>
      </div>
    </aside>
    <main className="ops-main"><header className="ops-topbar"><div className="ops-breadcrumb"><span>AHBA WORKSPACE</span><span className="ops-breadcrumb-divider">/</span><strong>{current}</strong></div><div className="ops-topbar-right"><span className="ops-status-dot"/><span className="ops-status-label">Workspace connected</span><span className="ops-role-pill">HR</span></div></header>
      <div className="ops-page employee-ops-page">
        <Routes>
          <Route path="/" element={<section className="card"><h1>HR portal</h1><p className="muted">Manage team schedules and confidential employee notices from one place.</p><div className="row" style={{gap:'.75rem',flexWrap:'wrap'}}><NavLink className="button primary" to="/schedule">Open team schedules</NavLink><NavLink className="button" to="/ntes">Manage NTEs</NavLink></div></section>}/>
          <Route path="/schedule" element={<MySchedule/>}/>
          <Route path="/ntes" element={<HrNtes/>}/>
          <Route path="/files" element={<EmployeeFiles settings={settings} />}/>
          <Route path="/file/:id" element={<FileViewer/>}/>
          <Route path="/settings" element={<Settings/>}/>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
        <footer className="emp-footer"><span>AHBA Development</span><span>Shared Workspace · HR Portal</span></footer>
      </div>
    </main>
  </div>
}