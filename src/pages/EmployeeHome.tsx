
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useNotifs } from '../lib/notifications'
import { prettyDate, todayIso } from '../lib/dates'
import { Icon } from '../components/Nav'
import Announcements from '../components/Announcements'
import type { DashSettings } from '../lib/settings'
import type { FileRow } from '../types'
import '../components/tabs.css'

const nice = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

export default function EmployeeHome({ settings }: { settings: DashSettings }) {
  const { profile } = useAuth()
  const { items, unread, loading, error, offline, ack, done, markRead } = useNotifs()
  const [recent, setRecent] = useState<FileRow[]>([])
  const today = todayIso()

  useEffect(() => {
    supabase.from('files').select('*')
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => setRecent((data ?? []) as FileRow[]))
  }, [])

  const name = profile?.full_name?.trim()
    ? nice(profile.full_name.trim().split(' ')[0])
    : 'there'
  const open = items.filter(n => !n.done_at)
  const attention = open.filter(n => !n.ack_at).slice(0, 3)
  const deadlines = open.filter(n => n.due_on)
    .sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1)).slice(0, 5)
  const updated = new Set(items.filter(n => !n.read_at && n.file_id).map(n => n.file_id))
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  })

  return (
    <div className="emp-dashboard">
      <section className="emp-welcome">
        <div className="welcome-copy">
          <span className="emp-eyebrow">YOUR WORKSPACE</span>
          <h1>Good day, {name} <span aria-hidden="true">✦</span></h1>
          <p>{dateLabel} <span className="welcome-divider">/</span>
            {' '}{unread ? `${unread} unread update${unread === 1 ? '' : 's'}` : 'You’re all caught up'}
          </p>
        </div>
        <div className="welcome-seal"><Icon name="home" /></div>
      </section>

      {offline && <div className="notice">You are offline. Showing reminders saved on this device.</div>}
      {error && !offline && <div className="notice error">{error}</div>}

      <section className="emp-section">
        <div className="emp-section-heading">
          <div><span className="emp-eyebrow">QUICK ACCESS</span><h2>Go to</h2></div>
        </div>
        <div className="quick-grid">
          <Link to="/schedule" className="qa"><span className="qa-icon"><Icon name="schedule" /></span><span>My schedule</span><small>Work assignments</small></Link>
          <Link to="/files" className="qa"><span className="qa-icon"><Icon name="files" /></span><span>Files & resources</span><small>Shared documents</small></Link>
          <Link to="/notifications" className="qa"><span className="qa-icon"><Icon name="bell" /></span><span>Notifications</span><small>{unread ? `${unread} unread` : 'All up to date'}</small></Link>
          <Link to="/profile" className="qa"><span className="qa-icon"><Icon name="user" /></span><span>My ID card</span><small>Profile & account</small></Link>
        </div>
      </section>

      <section className="emp-section">
        <div className="emp-section-heading">
          <div><span className="emp-eyebrow">ACTION CENTER</span><h2>Needs your attention</h2></div>
          <Link to="/notifications" className="emp-text-link">View all</Link>
        </div>
        {loading && <div className="skeleton" />}
        {!loading && attention.length === 0 && (
          <div className="emp-empty"><span className="empty-check">✓</span><div><strong>You’re all caught up</strong><p>Nothing needs your attention right now.</p></div></div>
        )}
        {attention.map(n => (
          <article key={n.id} className="notif-card unread">
            <div className="notif-card-heading"><span className="notif-mark"><Icon name="bell" /></span><strong>{n.title}</strong></div>
            {n.body && <p>{n.body}</p>}
            <div className="row emp-action-row">
              {n.file_id && <Link className="btn small" to={`/file/${n.file_id}`} onClick={() => markRead([n.id])}>Open file</Link>}
              <button className="small" onClick={() => ack(n.id)}>Acknowledge</button>
              <button className="small primary" onClick={() => done(n.id)}>Mark done</button>
            </div>
          </article>
        ))}
      </section>

      <section className="emp-section">
        <div className="emp-section-heading">
          <div><span className="emp-eyebrow">KEEP ON TRACK</span><h2>Upcoming deadlines</h2></div>
        </div>
        {!loading && deadlines.length === 0 && <div className="emp-empty"><div><strong>No upcoming deadlines</strong><p>Any assigned deadlines will appear here.</p></div></div>}
        {deadlines.map(n => {
          const late = n.due_on! < today
          return (
            <article key={n.id} className="deadline">
              <span className="deadline-icon"><Icon name="schedule" /></span>
              <div className="deadline-copy"><strong>{n.title}</strong><span>{prettyDate(n.due_on!)}</span></div>
              <span className={`badge${late ? ' admin' : n.due_on === today ? ' pulse' : ''}`}>{late ? 'Overdue' : n.due_on === today ? 'Today' : 'Upcoming'}</span>
            </article>
          )
        })}
      </section>

      <section className="emp-section">
        <div className="emp-section-heading">
          <div><span className="emp-eyebrow">FROM YOUR TEAM</span><h2>Announcements</h2></div>
        </div>
        <Announcements canPost={false} />
      </section>

      <section className="emp-section">
        <div className="emp-section-heading">
          <div><span className="emp-eyebrow">RECENT ACTIVITY</span><h2>Recently shared files</h2></div>
          <Link to="/files" className="emp-text-link">All files</Link>
        </div>
        {recent.length === 0 && <div className="emp-empty"><div><strong>No shared files yet</strong><p>New files will appear here when available.</p></div></div>}
        {recent.map(f => (
          <Link key={f.id} className="file-item" to={f.kind === 'gsheet' ? `/file/${f.id}` : '/files'}>
            <span className="recent-file-icon"><Icon name="files" /></span>
            <div className="recent-file-copy">
              <strong>{f.title}</strong>
              <span>{f.month_label || 'Shared resource'}{updated.has(f.id) ? ' · Updated' : ''}</span>
            </div>
            <span className="recent-arrow">↗</span>
          </Link>
        ))}
        {settings.show_search && <p className="muted emp-search-hint">Search all your files from the Files tab.</p>}
      </section>
    </div>
  )
}
