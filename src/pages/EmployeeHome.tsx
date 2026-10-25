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
    supabase
      .from('files')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => setRecent((data ?? []) as FileRow[]))
  }, [])

  const name = profile?.full_name?.trim() ? nice(profile.full_name.trim().split(' ')[0]) : 'there'
  const open = items.filter((n) => !n.done_at)
  const attention = open.filter((n) => !n.ack_at).slice(0, 3)
  const deadlines = open
    .filter((n) => n.due_on)
    .sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1))
    .slice(0, 5)
  const updated = new Set(items.filter((n) => !n.read_at && n.file_id).map((n) => n.file_id))

  return (
    <>
      <div className="card glass">
        <h1 style={{ marginBottom: '0.15rem' }}>Hi, {name} 👋</h1>
        <p className="muted" style={{ margin: 0 }}>
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {' · '}
          {unread > 0 ? `${unread} unread` : 'all caught up'}
        </p>
      </div>

      {offline && <div className="notice">You are offline. Showing reminders saved on this device.</div>}
      {error && !offline && <div className="notice error">{error}</div>}

      <div className="quick-grid">
        <Link to="/schedule" className="qa"><Icon name="schedule" /><span>My schedule</span></Link>
        <Link to="/files" className="qa"><Icon name="files" /><span>Files</span></Link>
        <Link to="/notifications" className="qa"><Icon name="bell" /><span>Alerts{unread > 0 ? ` (${unread})` : ''}</span></Link>
        <Link to="/settings" className="qa"><Icon name="user" /><span>Profile</span></Link>
      </div>

      <div className="section-title">Needs your attention</div>
      {loading && <div className="skeleton" />}
      {!loading && attention.length === 0 && <div className="empty">Nothing needs your attention.</div>}
      {attention.map((n) => (
        <div key={n.id} className="notif-card unread">
          <strong>{n.title}</strong>
          {n.body && <p style={{ margin: '0.3rem 0' }}>{n.body}</p>}
          <div className="row" style={{ gap: '0.4rem' }}>
            {n.file_id && <Link className="btn small" to={`/file/${n.file_id}`} onClick={() => markRead([n.id])}>Open file</Link>}
            <button className="small" onClick={() => ack(n.id)}>Got it</button>
            <button className="small primary" onClick={() => done(n.id)}>Mark done</button>
          </div>
        </div>
      ))}

      <div className="section-title">Upcoming deadlines</div>
      {!loading && deadlines.length === 0 && <div className="empty">No deadlines right now.</div>}
      {deadlines.map((n) => {
        const late = n.due_on! < today
        return (
          <div key={n.id} className="deadline">
            <div>
              <strong>{n.title}</strong>
              <div className="muted" style={{ fontSize: '0.82rem' }}>{prettyDate(n.due_on!)}</div>
            </div>
            <span className={`badge${late ? ' admin' : n.due_on === today ? ' pulse' : ''}`}>{late ? 'Overdue' : n.due_on === today ? 'Today' : 'Upcoming'}</span>
          </div>
        )
      })}

      <Announcements canPost={false} />

      <div className="section-title">Recent files</div>
      {recent.length === 0 && <div className="empty">No files shared with you yet.</div>}
      {recent.map((f) => (
        <Link key={f.id} className="file-item" to={f.kind === 'gsheet' ? `/file/${f.id}` : '/files'}>
          <div className="meta">
            <strong>{f.title}</strong>
            {updated.has(f.id) && <span className="badge pulse">Updated</span>}
          </div>
          <span className="muted">{f.month_label ?? ''}</span>
        </Link>
      ))}
      {settings.show_search && <p className="muted" style={{ fontSize: '0.8rem' }}>Search all your files on the Files tab.</p>}
    </>
  )
}
