import { useEffect, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { FileRow } from '../types'

const btn = { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' } as const

function displayName(full: string | null | undefined, email: string | undefined) {
  if (full && full.trim()) return full.trim().split(' ')[0]
  const first = (email ?? '').split('@')[0].split(/[._-]/)[0]
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'there'
}

function Tilt({ children, className = '' }: { children: ReactNode; className?: string }) {
  function move(e: PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--ry', `${x * 14}deg`)
    el.style.setProperty('--rx', `${-y * 14}deg`)
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

export default function Overview() {
  const { profile } = useAuth()
  const isOwner = profile?.role === 'owner'
  const [stats, setStats] = useState({ files: 0, people: 0, assignments: 0 })
  const [recent, setRecent] = useState<FileRow[]>([])

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

  const name = displayName(profile?.full_name, profile?.email)

  return (
    <>
      <Tilt className="hero rise">
        <div className="orb a" />
        <div className="orb b" />
        <div className="orb c" />
        <h1 className="pop">Hi, {name} 👋</h1>
        <p className="pop">Here is what is happening in your workspace.</p>
      </Tilt>

      <div className="grid metrics" style={{ marginBottom: '1rem' }}>
        <Tilt className="card rise">
          <div className="muted">Files</div>
          <div className="metric-value pop">{stats.files}</div>
        </Tilt>
        <Tilt className="card rise">
          <div className="muted">Active employees</div>
          <div className="metric-value pop">{stats.people}</div>
        </Tilt>
        <Tilt className="card rise">
          <div className="muted">File assignments</div>
          <div className="metric-value pop">{stats.assignments}</div>
        </Tilt>
      </div>

      <div className="card rise">
        <h2>Quick actions</h2>
        <div className="row">
          <Link className="btn primary" style={btn} to="/files">Add a file</Link>
          {isOwner && <Link className="btn" style={btn} to="/people">Invite employees</Link>}
          {isOwner && <Link className="btn" style={btn} to="/design">Customize dashboard</Link>}
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
