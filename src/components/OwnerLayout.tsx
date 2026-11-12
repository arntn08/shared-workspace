import { useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { Avatar, Icon, ThemeButton } from './Nav'
import Overview from '../pages/Overview'
import Files from '../pages/Files'
import People from '../pages/People'
import DashboardDesign from '../pages/DashboardDesign'
import Activity from '../pages/Activity'
import Settings from '../pages/Settings'
import HrTeamSchedule from '../pages/HrTeamSchedule'
import FileViewer from '../pages/FileViewer'
import Tally from '../pages/Tally'
import TeamSettings from '../pages/TeamSettings'
import ARGenerator from '../pages/ARGenerator'
import ProjectActivities from '../pages/ProjectActivities'
import { HrWeeklyTeamReports } from './HrLayout'
import { WorkforceMap } from '../pages/WorkforceLocation'

const ownerLinks: [string, string, string, string][] = [
  ['/', 'Overview', 'home', 'Workspace'],
  ['/tally', 'Installation Tally', 'tally', 'Operations'],
  ['/ar', 'AR Generator', 'receipt', 'Operations'],
  ['/schedule', 'Team Schedule', 'schedule', 'Operations'],
  ['/project-coordinator', 'Project Coordinator', 'calendar-check', 'Operations'],
  ['/workforce-map', 'Live Workforce Map', 'map-pin', 'Management'],
  ['/files', 'Files & resources', 'files', 'Workspace'],
  ['/teams', 'Team Settings', 'users-round', 'Management'],
  ['/people', 'People', 'people', 'Management'],
  ['/design', 'Dashboard design', 'design', 'Management'],
  ['/activity', 'Activity log', 'activity', 'Management'],
  ['/settings', 'Settings', 'settings', 'Account']
]

const editorLinks: [string, string, string, string][] = [
  ['/', 'Overview', 'home', 'Workspace'],
  ['/tally', 'Installation Tally', 'tally', 'Operations'],
  ['/ar', 'AR Generator', 'receipt', 'Operations'],
  ['/schedule', 'Schedule', 'schedule', 'Operations'],
  ['/weekly-reports', 'Weekly Team Reports', 'chart', 'Operations'],
  ['/workforce-map', 'Live Workforce Map', 'map-pin', 'Management'],
  ['/files', 'Files & resources', 'files', 'Workspace'],
  ['/teams', 'Team Settings', 'users-round', 'Management'],
  ['/people', 'People', 'people', 'Management'],
  ['/settings', 'Settings', 'settings', 'Account']
]

export default function OwnerLayout() {
  const { profile, signOut } = useAuth()
  const [settings] = useSettings()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const isOwner = profile?.role === 'owner'
  const links = isOwner ? ownerLinks : editorLinks
  const currentPage = links.find(([to]) => to === '/' ? location.pathname === '/' : location.pathname.startsWith(to))?.[1] ?? 'Workspace'
  const groups = ['Workspace', 'Operations', 'Management', 'Account']

  return <div className="ops-shell role-theme-blue">
    <button className="ops-mobile-toggle" type="button" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} onClick={() => setMobileOpen(value => !value)}><span className="ops-toggle-lines">{mobileOpen ? '×' : '☰'}</span><span>{settings.title || 'AHBA Workspace'}</span></button>
    {mobileOpen && <button className="ops-mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`ops-sidebar${mobileOpen ? ' is-open' : ''}`}>
      <div className="ops-brand"><div className="ops-brand-mark">A</div><div className="ops-brand-copy"><strong>AHBA</strong><span>{settings.title || 'Development Workspace'}</span></div><button className="ops-sidebar-close" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>×</button></div>
      <nav className="ops-nav" aria-label="Main navigation">
        {groups.map(group => { const groupLinks = links.filter(item => item[3] === group); if (!groupLinks.length) return null
          return <div className="ops-nav-group" key={group}><div className="ops-nav-heading">{group}</div>{groupLinks.map(([to,label,icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileOpen(false)} className={({isActive}) => `ops-nav-link${isActive ? ' active' : ''}`}><span className="ops-nav-icon"><Icon name={icon} /></span><span className="ops-nav-label">{label}</span>{to === '/tally' && <span className="ops-nav-tag">LIVE</span>}</NavLink>)}</div>
        })}
      </nav>
      <div className="ops-sidebar-bottom">
        <div className="ops-profile"><Avatar name={profile?.full_name} email={profile?.email} /><div className="ops-profile-copy"><strong>{profile?.full_name || profile?.email || 'Account'}</strong><span>{profile?.role || 'Member'}</span></div><ThemeButton /><button className="ops-icon-button" type="button" onClick={async () => { await signOut(); navigate('/', { replace: true }) }} title="Sign out" aria-label="Sign out"><Icon name="out" /></button></div>
      </div>
    </aside>
    <main className="ops-main">
      <header className="ops-topbar"><div className="ops-breadcrumb"><span>AHBA WORKSPACE</span><span className="ops-breadcrumb-divider">/</span><strong>{currentPage}</strong></div><div className="ops-topbar-right"><span className="ops-status-dot" /><span className="ops-status-label">Workspace connected</span><span className="ops-role-pill">{profile?.role}</span></div></header>
      <div className="ops-page"><Routes>
        <Route path="/" element={<Overview />} /><Route path="/files" element={<Files />} /><Route path="/file/:id" element={<FileViewer />} /><Route path="/tally" element={<Tally />} /><Route path="/ar" element={<ARGenerator />} /><Route path="/schedule" element={<HrTeamSchedule />} /><Route path="/weekly-reports" element={<HrWeeklyTeamReports />} /><Route path="/workforce-map" element={<WorkforceMap />} /><Route path="/project-coordinator" element={isOwner ? <ProjectActivities coordinator /> : <Navigate to="/" replace />} /><Route path="/settings" element={<Settings />} /><Route path="/teams" element={<TeamSettings />} /><Route path="/people" element={<People />} />{isOwner && <Route path="/design" element={<DashboardDesign />} />}{isOwner && <Route path="/activity" element={<Activity />} />}<Route path="*" element={<Navigate to="/" replace />} />
      </Routes></div>
    </main>
  </div>
}