import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { Avatar, Icon, ThemeButton } from './Nav'
import ProjectActivities from '../pages/ProjectActivities'
import Tally from '../pages/Tally'
import HrTeamSchedule from '../pages/HrTeamSchedule'
import { HrWeeklyTeamReports } from './HrLayout'
import { WorkforceMap } from '../pages/WorkforceLocation'

const links: [string, string, string, string][] = [
  ['/', 'Project activities', 'calendar-check', 'Coordination'],
  ['/tally', 'Installation Tally', 'tally', 'Operations'],
  ['/schedule', 'Team Schedule', 'schedule', 'Operations'],
  ['/weekly-reports', 'Weekly Team Reports', 'chart', 'Operations'],
  ['/workforce-map', 'Live Workforce Map', 'map-pin', 'Operations']
]

export default function ProjectCoordinatorLayout() {
  const { profile, signOut } = useAuth()
  const [settings] = useSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const current = links.find(([to]) => to === '/' ? location.pathname === '/' : location.pathname.startsWith(to))?.[1] ?? 'Project Coordinator'

  return <div className="ops-shell employee-ops-shell role-theme-coordinator">
    <aside className="ops-sidebar">
      <div className="ops-brand"><img className="ops-brand-logo" src={`${import.meta.env.BASE_URL}AHBA%20LOGO%20TRANSPARENT.png`} alt="AHBA Development" />
        <div className="ops-brand-copy"><strong>AHBA Workspace</strong><span>Development Shared Workspace</span></div></div>
      <div className="ops-workspace-label">OPERATIONS & QA DISPATCH</div>
      <nav className="ops-nav" aria-label="Project Coordinator navigation">
        {(['Coordination','Operations'] as const).map(group => <div className="ops-nav-group" key={group}><div className="ops-nav-heading">{group}</div>
          {links.filter(item => item[3] === group).map(([to,label,icon]) => <NavLink key={to} to={to} end={to === '/'} className={({isActive})=>`ops-nav-link${isActive?' active':''}`}><span className="ops-nav-icon"><Icon name={icon}/></span><span className="ops-nav-label">{label}</span>{to === '/tally' && <span className="ops-nav-tag">LIVE</span>}</NavLink>)}
        </div>)}
      </nav>
      <div className="ops-sidebar-bottom"><div className="ops-help-card"><span className="ops-help-icon">✦</span><div><strong>Operations access</strong><span>Project Coordinator · QA Dispatcher</span></div></div>
        <div className="ops-profile"><Avatar name={profile?.full_name} email={profile?.email}/><div className="ops-profile-copy"><strong>{profile?.full_name||profile?.email}</strong><span>Project Coordinator / QA Dispatcher</span></div><ThemeButton/><button className="ops-icon-button" onClick={async()=>{await signOut();navigate('/',{replace:true})}} title="Sign out" aria-label="Sign out"><Icon name="out"/></button></div>
      </div>
    </aside>
    <main className="ops-main"><header className="ops-topbar"><div className="ops-breadcrumb"><span>AHBA WORKSPACE</span><span className="ops-breadcrumb-divider">/</span><strong>{current}</strong></div><div className="ops-topbar-right"><span className="ops-status-dot"/><span className="ops-status-label">Workspace connected</span><span className="ops-role-pill">Coordinator · QA</span></div></header>
      <div className="ops-page employee-ops-page"><Routes>
        <Route path="/" element={<ProjectActivities coordinator/>}/>
        <Route path="/tally" element={<Tally/>}/>
        <Route path="/schedule" element={<HrTeamSchedule/>}/>
        <Route path="/weekly-reports" element={<HrWeeklyTeamReports/>}/>
        <Route path="/workforce-map" element={<WorkforceMap/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes><footer className="emp-footer"><span>AHBA Development</span><span>Operations & QA Dispatcher Portal</span></footer></div>
    </main>
  </div>
}