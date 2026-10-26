import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useNotifs } from '../lib/notifications'
import { useAuth } from '../lib/auth'
import { useLocalUpdates } from '../lib/offline'
import { prettyDate, todayIso } from '../lib/dates'
import '../components/tabs.css'

type Filter = 'all' | 'unread' | 'todo'

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Notifications() {
  const { items, unread, loading, error, offline, reload, markRead, ack, done } = useNotifs()
  const { profile } = useAuth()
  const local = useLocalUpdates(profile?.id)
  const [filter, setFilter] = useState<Filter>('all')
  const today = todayIso()

  const shown = items.filter((n) => (filter === 'unread' ? !n.read_at : filter === 'todo' ? !n.done_at : true))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="muted" style={{ margin: 0 }}>{unread > 0 ? `${unread} unread` : 'You are all caught up.'}</p>
        </div>
        {unread > 0 && (
          <button className="small" onClick={() => markRead(items.filter((n) => !n.read_at).map((n) => n.id))}>Mark all read</button>
        )}
      </div>

      {local.list.length > 0 && (
        <>
          <div className="row between">
            <div className="section-title" style={{ margin: '0.5rem 0' }}>Updates on this device</div>
            {local.unread > 0 && <button className="small" onClick={local.markAllRead}>Mark read</button>}
          </div>
          {local.list.map((u) => (
            <div key={u.id} className={`notif-card${u.read ? '' : ' unread'}`}>
              <div className="row between">
                <strong>{u.title}</strong>
                <span className="muted" style={{ fontSize: '0.8rem' }}>{ago(new Date(u.at).toISOString())}</span>
              </div>
              <p style={{ margin: '0.35rem 0' }}>{u.body}</p>
              <div className="row" style={{ gap: '0.4rem' }}>
                <Link className="btn small" to="/schedule">Open schedule</Link>
                <button className="small" onClick={() => local.dismiss(u.id)}>Dismiss</button>
              </div>
            </div>
          ))}
        </>
      )}

      {offline && <div className="notice">You are offline. Showing the reminders saved on this device.</div>}
      {error && !offline && (
        <div className="notice error">
          {error} <button className="small" onClick={reload}>Try again</button>
        </div>
      )}

      <div className="chips">
        {([['all', 'All'], ['unread', 'Unread'], ['todo', 'To do']] as [Filter, string][]).map(([k, label]) => (
          <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {loading && (
        <>
          <div className="skeleton" />
          <div className="skeleton" />
        </>
      )}
      {!loading && shown.length === 0 && <div className="empty">Nothing here yet.</div>}

      {shown.map((n) => {
        const overdue = !!n.due_on && n.due_on < today && !n.done_at
        return (
          <div key={n.id} className={`notif-card${n.read_at ? '' : ' unread'}`}>
            <div className="row between">
              <strong>{n.title}</strong>
              <span className="muted" style={{ fontSize: '0.8rem' }}>{ago(n.deliver_at)}</span>
            </div>
            {n.body && <p style={{ margin: '0.35rem 0' }}>{n.body}</p>}
            <div className="row" style={{ gap: '0.4rem', marginBottom: '0.5rem' }}>
              {n.due_on && <span className={`badge${overdue ? ' admin' : ''}`}>{overdue ? 'Overdue · ' : 'Due '}{prettyDate(n.due_on)}</span>}
              {n.done_at ? <span className="badge edit">Done</span> : n.ack_at ? <span className="badge">Acknowledged</span> : null}
              <span className={`st ${n.push_status}`}>Push: {n.push_status}</span>
              <span className={`st ${n.email_status}`}>Email: {n.email_status}</span>
            </div>
            <div className="row" style={{ gap: '0.4rem' }}>
              {n.file_id && <Link className="btn small" to={`/file/${n.file_id}`} onClick={() => markRead([n.id])}>Open file</Link>}
              {!n.ack_at && <button className="small" onClick={() => ack(n.id)}>Got it</button>}
              {!n.done_at && <button className="small primary" onClick={() => done(n.id)}>Mark done</button>}
              {!n.read_at && !n.file_id && <button className="small" onClick={() => markRead([n.id])}>Mark read</button>}
            </div>
          </div>
        )
      })}
    </>
  )
}
