import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { actionKind, actionLabel, detailText } from '../lib/labels'

type Filter = 'all' | 'view' | 'edit' | 'admin'
const filters: [Filter, string][] = [
  ['all', 'Everything'],
  ['view', 'Views & sign-ins'],
  ['edit', 'Changes'],
  ['admin', 'Admin']
]

function initials(value: string) {
  const name = value.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return name.split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase() || '?'
}

function relativeTime(value: string) {
  const date = new Date(value)
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
}

export default function Activity() {
  const [rows, setRows] = useState<any[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    const { data, error: loadError } = await supabase
      .from('audit_logs')
      .select('id,action,detail,created_at,profiles(email)')
      .order('created_at', { ascending: false })
      .limit(300)
    if (loadError) setError('Activity could not be loaded. Check your connection or audit-log permissions, then try again.')
    setRows(data ?? [])
    setBusy(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows.filter(r =>
      (filter === 'all' || actionKind(r.action) === filter) &&
      (!term ||
        String(r.profiles?.email ?? '').toLowerCase().includes(term) ||
        String(r.action ?? '').toLowerCase().includes(term) ||
        detailText(r.detail).toLowerCase().includes(term))
    )
  }, [rows, filter, q])

  const counts = useMemo(() => ({
    all: rows.length,
    view: rows.filter(r => actionKind(r.action) === 'view').length,
    edit: rows.filter(r => actionKind(r.action) === 'edit').length,
    admin: rows.filter(r => actionKind(r.action) === 'admin').length
  }), [rows])

  return (
    <section className="activity-page">
      <header className="activity-hero">
        <div className="activity-hero-glow" aria-hidden="true" />
        <div className="activity-hero-copy">
          <div className="activity-eyebrow"><span className="activity-live-dot" /> WORKSPACE AUDIT TRAIL</div>
          <h1>Activity log</h1>
          <p>A clear timeline of who accessed the workspace and what changed.</p>
        </div>
        <button className="activity-refresh" type="button" onClick={() => void load()} disabled={busy}>
          <span aria-hidden="true">↻</span> {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className="activity-metrics">
        <div className="activity-metric"><span className="activity-metric-icon all">◷</span><div><span>Recent events</span><strong>{counts.all}</strong></div><small>Latest 300</small></div>
        <div className="activity-metric"><span className="activity-metric-icon view">↗</span><div><span>Views & sign-ins</span><strong>{counts.view}</strong></div></div>
        <div className="activity-metric"><span className="activity-metric-icon edit">✎</span><div><span>Changes</span><strong>{counts.edit}</strong></div></div>
        <div className="activity-metric"><span className="activity-metric-icon admin">⌘</span><div><span>Admin actions</span><strong>{counts.admin}</strong></div></div>
      </div>

      <div className="activity-toolbar">
        <div className="activity-search"><span aria-hidden="true">⌕</span><input aria-label="Search activity" placeholder="Search people, actions or details…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="activity-filter" role="group" aria-label="Filter activity">
          {filters.map(([key, label]) => <button key={key} type="button" className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
      </div>

      <div className="activity-feed-card">
        <div className="activity-feed-heading">
          <div><h2>Latest activity</h2><p>Newest events appear first</p></div>
          <span className="activity-result-count">{shown.length} {shown.length === 1 ? 'event' : 'events'}</span>
        </div>
        {busy && <div className="activity-empty"><span className="activity-loader" />Loading activity…</div>}
        {!busy && error && <div className="activity-empty"><strong>Unable to load activity</strong><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>}
        {!busy && !error && shown.length === 0 && <div className="activity-empty"><span className="activity-empty-icon">⌕</span><strong>No matching activity</strong><p>Try another search or select a different filter.</p><button type="button" onClick={() => { setQ(''); setFilter('all') }}>Clear filters</button></div>}
        {!busy && !error && shown.length > 0 && (
          <div className="activity-feed">
            {shown.map((r) => {
              const kind = actionKind(r.action)
              const email = String(r.profiles?.email ?? 'Unknown user')
              return <article className="activity-event" key={r.id}>
                <div className={`activity-event-avatar ${kind}`}>{initials(email)}</div>
                <div className="activity-event-main">
                  <div className="activity-event-title"><strong>{actionLabel(r.action)}</strong><span className={`activity-tag ${kind}`}>{kind === 'view' ? 'ACCESS' : kind === 'edit' ? 'CHANGE' : 'ADMIN'}</span></div>
                  <div className="activity-event-detail">{detailText(r.detail)}</div>
                  <div className="activity-event-actor"><span>{email}</span><span className="activity-event-dot">·</span><span>{new Date(r.created_at).toLocaleString()}</span></div>
                </div>
                <time dateTime={r.created_at} title={new Date(r.created_at).toLocaleString()}>{relativeTime(r.created_at)}</time>
              </article>
            })}
          </div>
        )}
        <footer className="activity-feed-footer"><span className="activity-live-dot" /> Showing up to 300 recent records from the workspace audit log</footer>
      </div>
    </section>
  )
}
