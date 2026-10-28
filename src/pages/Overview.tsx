
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import Hero from '../components/Hero'
import Announcements from '../components/Announcements'
import { actionKind, actionLabel, detailText } from '../lib/labels'
import type { FileRow } from '../types'

type DailyCount = {
  work_date: string
  daily_count: number
}

type ActivityRow = {
  id: string
  action: string
  detail: unknown
  created_at: string
  profiles?: { email?: string } | null
}

type OverviewStats = {
  files: number
  people: number
  assignments: number
  activeTeams: number
  wtd: number
  mtd: number
  completedInstalled: number
}

function localISO(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function getWeekStart(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  start.setHours(12, 0, 0, 0)
  return start
}

function displayName(full?: string | null, email?: string) {
  const first = full?.trim().split(/\s+/)[0]
  if (first) return first.charAt(0).toUpperCase() + first.slice(1)
  const part = (email ?? '').split('@')[0].split(/[._-]/)[0]
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : 'there'
}

function StatCard({
  label,
  value,
  note,
  symbol
}: {
  label: string
  value: number
  note: string
  symbol: string
}) {
  return (
    <article className="ops-stat-card">
      <div className="ops-stat-top">
        <span>{label}</span>
        <span className="ops-stat-symbol">{symbol}</span>
      </div>
      <strong className="ops-stat-number">{value.toLocaleString()}</strong>
      <span className="ops-stat-note">{note}</span>
    </article>
  )
}

export default function Overview() {
  const { profile } = useAuth()
  const isOwner = profile?.role === 'owner'

  const [stats, setStats] = useState<OverviewStats>({
    files: 0,
    people: 0,
    assignments: 0,
    activeTeams: 0,
    wtd: 0,
    mtd: 0,
    completedInstalled: 0
  })
  const [recent, setRecent] = useState<FileRow[]>([])
  const [days, setDays] = useState<{ key: string; label: string; count: number }[]>([])
  const [feed, setFeed] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadOverview() {
      setLoading(true)
      setLoadError('')

      try {
        const now = new Date()
        const today = localISO(now)
        const monthStart = `${today.slice(0, 7)}-01`
        const weekStart = localISO(getWeekStart(now))
        const queryStart = weekStart < monthStart ? weekStart : monthStart

        const [files, people, assignments, recentFiles, teams, daily, completed] =
          await Promise.all([
            supabase.from('files').select('*', { count: 'exact', head: true }),
            supabase.from('profiles').select('*', { count: 'exact', head: true })
              .eq('role', 'employee').eq('active', true),
            supabase.from('assignments').select('*', { count: 'exact', head: true }),
            supabase.from('files').select('*')
              .order('created_at', { ascending: false }).limit(5),
            supabase.from('installation_teams').select('id', { count: 'exact', head: true })
              .eq('active', true),
            supabase.from('installation_daily_counts')
              .select('work_date,daily_count')
              .gte('work_date', queryStart)
              .lte('work_date', today),
            supabase.from('installation_imported_work_orders')
              .select('wo_id', { count: 'exact', head: true })
              .eq('status', 'COMPLETED')
              .gte('work_date', monthStart)
              .lte('work_date', `${today.slice(0, 7)}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`)
          ])

        if (daily.error) throw daily.error
        if (teams.error) throw teams.error
        if (completed.error) throw completed.error

        const records = (daily.data ?? []) as DailyCount[]
        const wtd = records
          .filter(row => row.work_date >= weekStart && row.work_date <= today)
          .reduce((sum, row) => sum + Number(row.daily_count || 0), 0)
        const mtd = records
          .filter(row => row.work_date >= monthStart && row.work_date <= today)
          .reduce((sum, row) => sum + Number(row.daily_count || 0), 0)

        const dayBuckets = Array.from({ length: 7 }, (_, index) => {
          const date = new Date()
          date.setDate(date.getDate() - (6 - index))
          const key = localISO(date)
          return {
            key,
            label: date.toLocaleDateString(undefined, { weekday: 'short' }),
            count: records
              .filter(row => row.work_date === key)
              .reduce((sum, row) => sum + Number(row.daily_count || 0), 0)
          }
        })

        if (cancelled) return

        setStats({
          files: files.count ?? 0,
          people: people.count ?? 0,
          assignments: assignments.count ?? 0,
          activeTeams: teams.count ?? 0,
          wtd,
          mtd,
          completedInstalled: completed.count ?? 0
        })
        setRecent((recentFiles.data ?? []) as FileRow[])
        setDays(dayBuckets)

        if (isOwner) {
          const latest = await supabase
            .from('audit_logs')
            .select('id,action,detail,created_at,profiles(email)')
            .order('created_at', { ascending: false })
            .limit(6)

          if (!cancelled) setFeed((latest.data ?? []) as ActivityRow[])
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Some dashboard information could not be loaded.'
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadOverview()
    const refreshId = window.setInterval(() => { void loadOverview() }, 30000)
    return () => { cancelled = true; window.clearInterval(refreshId) }
  }, [isOwner])

  const name = displayName(profile?.full_name, profile?.email)
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
  const maxDay = Math.max(1, ...days.map(day => day.count))

  return (
    <section className="ops-overview">
      <div className="ops-overview-heading">
        <div>
          <span className="ops-eyebrow">OPERATIONS CENTER</span>
          <h1>Good day, {name}.</h1>
          <p>{today} <span className="ops-heading-separator">·</span> Your workspace at a glance.</p>
        </div>
        <span className="ops-date-chip">AHBA Development</span>
      </div>

      {loadError && <div className="notice error">{loadError}</div>}

      <div className="ops-overview-hero">
        <div className="ops-hero-copy">
          <span className="ops-eyebrow">INSTALLATION PERFORMANCE</span>
          <h2>Keep every team in sync.</h2>
          <p>Review daily installation counts and track team performance throughout the month.</p>
          <div className="ops-hero-actions">
            <Link className="btn primary" to="/tally">Open installation tally ↗</Link>
            <Link className="btn" to="/schedule">View schedule</Link>
          </div>
        </div>
        <div className="ops-hero-orbit" aria-hidden="true">
          <div className="ops-orbit-ring ops-ring-one" />
          <div className="ops-orbit-ring ops-ring-two" />
          <div className="ops-orbit-center">A</div>
        </div>
      </div>

      <div className="ops-section-heading">
        <div>
          <h2>Performance snapshot</h2>
          <p>Current reporting period · {new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        </div>
        <Link to="/tally" className="ops-text-link">View full report →</Link>
      </div>

      <div className="ops-overview-stats">
        <StatCard label="Completed installed" value={stats.completedInstalled} note="Completed work orders · current month" symbol="✓" />
        <StatCard label="Days left this month" value={Math.max(0, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate())} note="Until month-end" symbol="◷" />
        <StatCard label="Week-to-date" value={stats.wtd} note="All teams · Monday to today" symbol="↗" />
        <StatCard label="Month-to-date" value={stats.mtd} note="All teams · this month" symbol="▥" />
        <StatCard label="Active teams" value={stats.activeTeams} note="Across all departments" symbol="◈" />
        <StatCard label="Active employees" value={stats.people} note="Enabled employee accounts" symbol="♙" />
      </div>

      <div className="ops-overview-columns">
        <article className="ops-panel ops-trend-panel">
          <div className="ops-panel-heading">
            <div>
              <h2>Daily installation activity</h2>
              <p>Last 7 days · all departments</p>
            </div>
            <span className="ops-mini-badge">DAILY</span>
          </div>

          {loading ? (
            <div className="ops-loading">Loading performance…</div>
          ) : (
            <div className="ops-chart">
              {days.map(day => (
                <div className="ops-chart-column" key={day.key}>
                  <strong>{day.count.toLocaleString()}</strong>
                  <div className="ops-chart-track">
                    <span
                      style={{
                        height: `${day.count === 0 ? 3 : Math.max(8, (day.count / maxDay) * 100)}%`
                      }}
                    />
                  </div>
                  <span className="ops-chart-label">{day.label}</span>
                </div>
              ))}
            </div>
          )}
          <div className="ops-chart-footnote">Counts are calculated from saved daily team records.</div>
        </article>

        <article className="ops-panel ops-shortcuts-panel">
          <div className="ops-panel-heading">
            <div>
              <h2>Quick access</h2>
              <p>Common workspace tasks</p>
            </div>
          </div>

          <Link className="ops-shortcut" to="/tally">
            <span className="ops-shortcut-icon">▥</span>
            <span><strong>Installation tally</strong><small>Enter daily counts and review WTD/MTD</small></span>
            <b>→</b>
          </Link>
          <Link className="ops-shortcut" to="/schedule">
            <span className="ops-shortcut-icon">▦</span>
            <span><strong>Team schedule</strong><small>Check the current roster and assignments</small></span>
            <b>→</b>
          </Link>
          <Link className="ops-shortcut" to="/teams">
            <span className="ops-shortcut-icon">♧</span>
            <span><strong>Team settings</strong><small>Manage departments and active teams</small></span>
            <b>→</b>
          </Link>
          <Link className="ops-shortcut" to="/files">
            <span className="ops-shortcut-icon">▱</span>
            <span><strong>Files & resources</strong><small>Open shared company files</small></span>
            <b>→</b>
          </Link>
        </article>
      </div>

      <Announcements canPost />

      {isOwner && (
        <div className="ops-panel">
          <div className="ops-panel-heading">
            <div>
              <h2>Recent workspace activity</h2>
              <p>Latest recorded actions</p>
            </div>
            <Link to="/activity" className="ops-text-link">Full activity log →</Link>
          </div>
          {feed.length === 0 ? (
            <p className="muted">No recent activity to show.</p>
          ) : (
            <div className="ops-activity-list">
              {feed.map(row => (
                <div className="ops-activity-row" key={row.id}>
                  <span className={`dot ${actionKind(row.action)}`} />
                  <div>
                    <strong>{row.profiles?.email ?? 'Workspace member'}</strong>
                    <span>{actionLabel(row.action)} · {detailText(row.detail)}</span>
                  </div>
                  <time>{new Date(row.created_at).toLocaleString()}</time>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="ops-overview-columns ops-lower-columns">
        <article className="ops-panel">
          <div className="ops-panel-heading">
            <div>
              <h2>Workspace resources</h2>
              <p>Content and collaboration overview</p>
            </div>
          </div>
          <div className="ops-resource-metrics">
            <div><span>Shared files</span><strong>{stats.files.toLocaleString()}</strong></div>
            <div><span>File assignments</span><strong>{stats.assignments.toLocaleString()}</strong></div>
          </div>
          <Link className="ops-text-link" to="/files">Browse shared files →</Link>
        </article>

        <article className="ops-panel">
          <div className="ops-panel-heading">
            <div>
              <h2>Recently added files</h2>
              <p>Latest shared resources</p>
            </div>
          </div>
          {recent.length === 0 ? (
            <p className="muted">No files have been added yet.</p>
          ) : (
            <div className="ops-recent-files">
              {recent.map(file => (
                <Link
                  className="ops-recent-file"
                  key={file.id}
                  to={file.kind === 'gsheet' ? `/file/${file.id}` : '/files'}
                >
                  <span className="ops-file-icon">▤</span>
                  <span><strong>{file.title}</strong><small>{file.month_label ?? file.kind}</small></span>
                  <b>→</b>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>

      {isOwner && (
        <div className="ops-footer-actions">
          <Link className="btn" to="/people">Manage people</Link>
          <Link className="btn" to="/design">Customize dashboard</Link>
        </div>
      )}
    </section>
  )
}
