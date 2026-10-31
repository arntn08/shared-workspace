import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { Avatar, Icon, ThemeButton } from './Nav'
import ProjectActivities from '../pages/ProjectActivities'

export default function TeamLeaderLayout() {
  const { profile, signOut } = useAuth()
  const [settings] = useSettings()
  const navigate = useNavigate()
  return <div className="ops-shell employee-ops-shell role-theme-hr">
    <aside className="ops-sidebar">
      <div className="ops-brand"><div className="ops-brand-mark">A</div><div className="ops-brand-copy"><strong>AHBA</strong><span>{settings.title || 'Development Workspace'}</span></div></div>
      <div className="ops-workspace-label">SALES TEAM PORTAL</div>
      <nav className="ops-nav"><div className="ops-nav-group"><div className="ops-nav-heading">Team activities</div><NavLink to="/" end className={({isActive})=>`ops-nav-link${isActive?' active':''}`}><span className="ops-nav-icon"><Icon name="calendar-check"/></span><span className="ops-nav-label">My team activities</span></NavLink></div></nav>
      <div className="ops-sidebar-bottom"><div className="ops-help-card"><span className="ops-help-icon">✦</span><div><strong>Dedicated access</strong><span>Team Leader portal</span></div></div>
        <div className="ops-profile"><Avatar name={profile?.full_name} email={profile?.email}/><div className="ops-profile-copy"><strong>{profile?.full_name||profile?.email}</strong><span>Sales Team Leader</span></div><ThemeButton/><button className="ops-icon-button" onClick={async()=>{await signOut();navigate('/',{replace:true})}} title="Sign out" aria-label="Sign out"><Icon name="out"/></button></div>
      </div>
    </aside>
    <main className="ops-main"><header className="ops-topbar"><div className="ops-breadcrumb"><span>AHBA WORKSPACE</span><span className="ops-breadcrumb-divider">/</span><strong>Team Leader Portal</strong></div><div className="ops-topbar-right"><span className="ops-status-dot"/><span className="ops-status-label">Workspace connected</span><span className="ops-role-pill">Team Leader</span></div></header>
      <div className="ops-page employee-ops-page"><Routes><Route path="/" element={<ProjectActivities/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes><footer className="emp-footer"><span>AHBA Development</span><span>Dedicated Sales Team Portal</span></footer></div>
    </main>
  </div>
}
