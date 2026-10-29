import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
import MyTeamSummary from '../pages/MyTeamSummary'
import EmployeeNtes from '../pages/EmployeeNtes'

const employeeLinks: [string, string, string, string][] = [
  ['/', 'Home', 'home', 'Workspace'],
  ['/files', 'Files & resources', 'files', 'Workspace'],
  ['/tally', 'Installation Tally', 'tally', 'Operations'],
  ['/my-team', 'My Team', 'users', 'Operations'],
  ['/schedule', 'Schedule', 'schedule', 'Operations'],
  ['/notifications', 'Notifications', 'bell', 'Operations'],
  ['/my-ntes', 'My NTEs', 'file-text', 'Operations'],
  ['/profile', 'My profile', 'user', 'Account'],
  ['/settings', 'Settings', 'settings', 'Account']
]

function SidebarClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const day = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'long'
  }).format(now)
  const date = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(now)
  const time = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(now)

  return (
    <section className="ops-sidebar-clock" aria-label="Current date and time">
      <div className="ops-clock-top"><span className="ops-clock-live-dot" /> PHILIPPINE TIME</div>
      <strong>{time}</strong>
      <span className="ops-clock-day">{day}</span>
      <span className="ops-clock-date">{date}</span>
    </section>
  )
}

function EmployeeSidebar({ title, mobileOpen, setMobileOpen }: {
  title: string
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}) {
  const { profile, signOut } = useAuth()
  const [settings] = useSettings()
  const [tallyExpanded, setTallyExpanded] = useState(true)
  const navigate = useNavigate()
  const { unread: serverUnread } = useNotifs()
  const local = useLocalUpdates(profile?.id)
  const unread = serverUnread + local.unread
  const groups = ['Workspace', 'Operations', 'Account']

  return (
    <>
      <button
        className="ops-mobile-toggle"
        type="button"
        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        <span className="ops-toggle-lines">{mobileOpen ? '×' : '☰'}</span>
        <span>{title || 'AHBA Workspace'}</span>
      </button>

      {mobileOpen && (
        <button
          className="ops-mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`ops-sidebar${mobileOpen ? ' is-open' : ''}`}>
        <div className="ops-brand">
          <div className="ops-brand-mark">A</div>
          <div className="ops-brand-copy">
            <strong>AHBA</strong>
            <span>{settings.title || 'Development Workspace'}</span>
          </div>
          <button
            className="ops-sidebar-close"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            ×
          </button>
        </div>

        <div className="ops-workspace-label">WORKSPACE</div>
        <SidebarClock />

        <nav className="ops-nav" aria-label="Employee navigation">
          {groups.map(group => {
            const groupLinks = employeeLinks.filter(item => item[3] === group)
            if (!groupLinks.length) return null

            return (
              <div className="ops-nav-group" key={group}>
                <div className="ops-nav-heading">{group}</div>
                {groupLinks.map(([to, label, icon]) => (
                  {to === '/my-team' ? null : (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      onClick={() => { setMobileOpen(false); if (to === '/tally') setTallyExpanded(true) }}
                      className={({ isActive }) => `ops-nav-link${isActive ? ' active' : ''}`}
                    >
                      <span className="ops-nav-icon"><Icon name={icon} /></span>
                      <span className="ops-nav-label">{label}</span>
                      {to === '/tally' && <span className="ops-nav-tag">LIVE</span>}
                      {to === '/notifications' && unread > 0 && (
                        <span className="ops-nav-tag">{unread > 99 ? '99+' : unread} NEW</span>
                      )}
                    </NavLink>
                  )}
                  {to === '/tally' && (
                    <div style={{ margin: '.15rem 0 .4rem 2.2rem' }}>
                      <button type="button" className="ops-nav-link" aria-expanded={tallyExpanded} onClick={() => setTallyExpanded(value => !value)} style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '.5rem', font: 'inherit', padding: '.45rem .55rem', opacity: .9 }}>
                        <span aria-hidden="true">{tallyExpanded ? '▾' : '▸'}</span>
                        <span className="ops-nav-label">My Team Summary</span>
                      </button>
                      {tallyExpanded && (
                        <NavLink to="/my-team" onClick={() => setMobileOpen(false)} className={({ isActive }) => `ops-nav-link${isActive ? ' active' : ''}`} style={{ marginLeft: '.3rem', fontSize: '.92em' }}>
                          <span className="ops-nav-icon"><Icon name="users" /></span>
                          <span className="ops-nav-label">My team</span>
                        </NavLink>
                      )}
                    </div>
                  )}
                ))}
              </div>
            )
          })}
        </nav>

        <div className="ops-sidebar-bottom">
          <div className="ops-help-card">
            <span className="ops-help-icon">✦</span>
            <div>
              <strong>Workspace access</strong>
              <span>Employee permissions</span>
            </div>
          </div>

          <div className="ops-profile">
            <Avatar name={profile?.full_name} email={profile?.email} />
            <div className="ops-profile-copy">
              <strong>{profile?.full_name || profile?.email || 'Account'}</strong>
              <span>Employee</span>
            </div>
            <ThemeButton />
            <button
              className="ops-icon-button"
              type="button"
              onClick={async () => { await signOut(); navigate('/', { replace: true }) }}
              title="Sign out"
              aria-label="Sign out"
            >
              <Icon name="out" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

export default function EmployeeLayout() {
  const [settings] = useSettings()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  const currentPage =
    employeeLinks.find(([to]) =>
      to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
    )?.[1] ?? 'Workspace'

  return (
    <NotifProvider>
      <div className="ops-shell employee-ops-shell">
        <EmployeeSidebar
          title={settings.title}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
        />

        <main className="ops-main">
          <header className="ops-topbar">
            <div className="ops-breadcrumb">
              <span>AHBA WORKSPACE</span>
              <span className="ops-breadcrumb-divider">/</span>
              <strong>{currentPage}</strong>
            </div>
            <div className="ops-topbar-right">
              <span className="ops-status-dot" />
              <span className="ops-status-label">Workspace connected</span>
              <span className="ops-role-pill">Employee</span>
            </div>
          </header>

          <div className="ops-page employee-ops-page">
            <Routes>
              <Route path="/" element={<EmployeeHome settings={settings} />} />
              <Route path="/tally" element={<Tally />} />
              <Route path="/my-team" element={<MyTeamSummary />} />
              <Route path="/files" element={<EmployeeFiles settings={settings} />} />
              <Route path="/file/:id" element={<FileViewer />} />
              <Route path="/schedule" element={<MySchedule />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/my-ntes" element={<EmployeeNtes />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>

            <footer className="emp-footer">
              <span>AHBA Development</span>
              <span>Shared Workspace · Employee Portal</span>
            </footer>
          </div>
        </main>
      </div>
    </NotifProvider>
  )
}
