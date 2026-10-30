import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { Avatar, Icon, ThemeButton } from './Nav'
import ARGenerator from '../pages/ARGenerator'
import Tally from '../pages/Tally'

const links = [['/','AR Generator','receipt'],['/tally','Installation Tally','tally']] as const

export default function ARLayout() {
  const { profile, signOut } = useAuth()
  const [settings] = useSettings()
  const location = useLocation()
  const navigate = useNavigate()
  const current = links.find(([to]) => to === '/' ? location.pathname === '/' : location.pathname.startsWith(to))?.[1] ?? 'AR workspace'
  return <div className="ops-shell employee-ops-shell role-theme-hr">
    <aside className="ops-sidebar">
      <div className="ops-brand"><div className="ops-brand-mark">A</div><div className="ops-brand-copy"><strong>AHBA</strong><span>{settings.title || 'Development Workspace'}</span></div></div>
      <div className="ops-workspace-label">AR WORKSPACE</div>
      <nav className="ops-nav" aria-label="AR navigation"><div className="ops-nav-group"><div className="ops-nav-heading">Operations</div>
        {links.map(([to,label,icon])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>`ops-nav-link${isActive?' active':''}`}><span className="ops-nav-icon"><Icon name={icon}/></span><span className="ops-nav-label">{label}</span></NavLink>)}
      </div></nav>
      <div className="ops-sidebar-bottom"><div className="ops-help-card"><span className="ops-help-icon">✦</span><div><strong>Restricted access</strong><span>AR Encoder permissions</span></div></div>
        <div className="ops-profile"><Avatar name={profile?.full_name} email={profile?.email}/><div className="ops-profile-copy"><strong>{profile?.full_name||profile?.email}</strong><span>AR Encoder</span></div><ThemeButton/><button className="ops-icon-button" onClick={async()=>{await signOut();navigate('/',{replace:true})}} title="Sign out" aria-label="Sign out"><Icon name="out"/></button></div>
      </div>
    </aside>
    <main className="ops-main"><header className="ops-topbar"><div className="ops-breadcrumb"><span>AHBA WORKSPACE</span><span className="ops-breadcrumb-divider">/</span><strong>{current}</strong></div><div className="ops-topbar-right"><span className="ops-status-dot"/><span className="ops-status-label">Workspace connected</span><span className="ops-role-pill">AR Encoder</span></div></header>
      <div className="ops-page employee-ops-page"><Routes><Route path="/" element={<ARGenerator/>}/><Route path="/tally" element={<Tally/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes><footer className="emp-footer"><span>AHBA Development</span><span>Shared Workspace · AR Portal</span></footer></div>
    </main>
  </div>
}
