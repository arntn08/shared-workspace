import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { FileRow } from '../types'

const btn = { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' } as const

export default function Overview() {
  const { profile } = useAuth()
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

  return (
    <>
      <h1>Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}</h1>
      <p className="muted">Here is what is happening in your workspace.</p>

      <div className="grid metrics" style={{ marginBottom: '1rem' }}>
        <div className="card"><div className="muted">Files</div><div className="metric-value">{stats.files}</div></div>
        <div className="card"><div className="muted">Active employees</div><div className="metric-value">{stats.people}</div></div>
        <div className="card"><div className="muted">File assignments</div><div className="metric-value">{stats.assignments}</div></div>
      </div>

      <div className="card">
        <h2>Quick actions</h2>
        <div className="row">
          <Link className="btn primary" style={btn} to="/files">Add a file</Link>
          <Link className="btn" style={btn} to="/people">Invite employees</Link>
          <Link className="btn" style={btn} to="/design">Customize dashboard</Link>
        </div>
      </div>

      <div className="card">
        <h2>Recently added files</h2>
        {recent.length === 0 && <p className="muted">No files yet.</p>}
        {recent.map((f) => (
          <div key={f.id} className="row between" style={{ padding: '0.4rem 0' }}>
            <span>{f.title}</span>
            <span className="badge">{f.month_label ?? f.kind}</span>
          </div>
        ))}
      </div>
    </>
  )
}
