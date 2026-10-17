import { useEffect, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { actionKind, actionLabel, detailText } from '../lib/labels'
import type { FileRow } from '../types'

function displayName(full: string | null | undefined, email: string | undefined) {
  if (full && full.trim()) return full.trim().split(' ')[0]
  const first = (email ?? '').split('@')[0].split(/[._-]/)[0]
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'there'
}

function useCountUp(target: number) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

function Tilt({ children, className = '' }: { children: ReactNode; className?: string }) {
  function move(e: PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--ry', `${x * 12}deg`)
    el.style.setProperty('--rx', `${-y * 12}deg`)
  }
  function leave(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.style.setProperty('--rx', '0deg')
    e.currentTarget.style.setProperty('--ry', '0deg')
  }
  return (
    <div className="scene">
      <div className={`tilt ${className}`} onPointerMove={move} onPointerLeave={leave} onPointerCancel={leave}>
        {children}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  const n = useCountUp(value)
  return (
    <Tilt className="card rise">
      <div className="muted">{label}</div>
      <div className="metric-value pop">{n}</div>
    </Tilt>
  )
}

export default function Overview() {
  const { profile } = useAuth()
  const isOwner = profile?.role === 'owner'
  const [stats, setStats] = useState({ files: 0, people: 0, assignments: 0 })
  const [recent, setRecent] = useState<FileRow[]>([])
  const [days, setDays] = useState<{ key: string; label: string; n: number }[]>([])
  const [feed, setFeed] = useState<any[]>([])

  useEffect(() => {
    ;(async () => {
      const [f, p, a, r] = await Promise.all([
        supabase.from('files').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'employee').eq('active', true),
        supabase.from('assignments').select('*', { count: 'exact', head: true }),
        supabase.from('files').select('*').order('created_at', { ascending: false }).limit(5)
      ])
      setStats({ files: f.count ?? 0, people: p.count ?? 0, assignments: a.count ?? 0 })
      setRecent((r.data ?? []) as FileRow[])
    })()
  }, [])

  useEffect(() => {
    if (!isOwner) return
    ;(async () => {
      const since = new Date(Date.now() - 6 * 864e5)
      since.setHours(0, 0, 0, 0)
      const { data } = await supabase.from('audit_logs').select('created_at').gte('created_at', since.toISOString()).limit(5000)
      const buckets = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(since.getTime() + i * 864e5)
        return { key: d.toDateString(), label: d.toLocaleDateString(undefined, { weekday: 'short' }), n: 0 }
      })
      ;(data ?? []).forEach((row: any) => {
        const k = new Date(row.created_at).toDateString()
        const b = buckets.find((x) => x.key === k)
        if (b) b.n++
      })
      setDays(buckets)
      const latest = await supabase
        .from('audit_logs')
        .select('id,action,detail,created_at,profiles(email)')
        .order('created_at', { ascending: false })
        .limit(6)
      setFeed(latest.data ?? [])
    })()
  }, [isOwner])

  const name = displayName(profile?.full_name, profile?.email)
  const max = Math.max(1, ...days.map((d) => d.n))
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <>
      <Tilt className="hero rise">
        <div className="topo">
          <div className="topo-plane">
            <i /><i /><i /><i /><i /><i /><i />
          </div>
        </div>
        <h1 className="pop">Hi, {name} 👋</h1>
        <p className="pop">{today} · here is what is happening in your workspace.</p>
      </Tilt>

      <div className="grid metrics" style={{ marginBottom: '1rem' }}>
        <Metric label="Files" value={stats.files} />
        <Metric label="Active employees" value={stats.people} />
        <Metric label="File assignments" value={stats.assignments} />
      </div>

      {isOwner && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="card rise">
            <h2>Activity · last 7 days</h2>
            <div className="bars">
              {days.map((d) => (
                <div className="bar" key={d.key}>
                  <b>{d.n}</b>
                  <div className="col">
                    <i style={{ height: `${Math.max(3, (d.n / max) * 100)}%` }} />
                  </div>
                  <span>{d.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card rise">
            <h2>Latest activity</h2>
            {feed.length === 0 && <p className="muted">Nothing yet.</p>}
            {feed.map((r) => (
              <div className="feed-item" key={r.id}>
                <span className={`dot ${actionKind(r.action)}`} />
                <div>
                  <div>{r.profiles?.email ?? 'Someone'} · {actionLabel(r.action)}</div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {detailText(r.detail)} {new Date(r.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card rise">
        <h2>Quick actions</h2>
        <div className="row">
          <Link className="btn primary" to="/files">Add a file</Link>
          {isOwner && <Link className="btn" to="/people">Add a person</Link>}
          {isOwner && <Link className="btn" to="/design">Customize dashboard</Link>}
        </div>
      </div>

      <div className="card rise">
        <h2>Recently added files</h2>
        {recent.length === 0 && <p className="muted">No files yet.</p>}
        {recent.map((f) => (
          <div key={f.id} className="row between" style={{ padding: '0.4rem 0' }}>
            <Link to={f.kind === 'gsheet' ? `/file/${f.id}` : '/files'}>{f.title}</Link>
            <span className="badge">{f.month_label ?? f.kind}</span>
          </div>
        ))}
      </div>
    </>
  )
}
