import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import Hero from '../components/Hero'
import Announcements from '../components/Announcements'
import type { DashSettings } from '../lib/settings'
import type { FileRow } from '../types'

const WEEK = 7 * 864e5
const nice = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

function firstName(full: string | null | undefined, email: string | undefined) {
  if (full && full.trim()) return nice(full.trim().split(' ')[0])
  const last = (email ?? '').split('@')[0].split(/[._-]/).pop() ?? ''
  return last ? nice(last) : 'there'
}

export default function EmployeeHome({ settings }: { settings: DashSettings }) {
  const { profile } = useAuth()
  const [files, setFiles] = useState<FileRow[]>([])
  const [added, setAdded] = useState<Record<string, string>>({})
  const [favs, setFavs] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    ;(async () => {
      const [f, a, v] = await Promise.all([
        supabase.from('files').select('*').order('created_at', { ascending: false }),
        supabase.from('assignments').select('file_id,created_at'),
        supabase.from('favorites').select('file_id')
      ])
      setFiles((f.data ?? []) as FileRow[])
      const m: Record<string, string> = {}
      ;(a.data ?? []).forEach((r: any) => {
        m[r.file_id] = r.created_at
      })
      setAdded(m)
      setFavs((v.data ?? []).map((r: any) => r.file_id as string))
      setBusy(false)
    })()
  }, [])

  async function toggleFav(f: FileRow) {
    const on = favs.includes(f.id)
    setFavs(on ? favs.filter((x) => x !== f.id) : [...favs, f.id])
    if (on) await supabase.from('favorites').delete().eq('user_id', profile!.id).eq('file_id', f.id)
    else await supabase.from('favorites').insert({ user_id: profile!.id, file_id: f.id })
  }

  const isNew = (f: FileRow) => !!added[f.id] && Date.now() - new Date(added[f.id]).getTime() < WEEK
  const needle = q.trim().toLowerCase()
  const shown = files.filter((f) => !needle || `${f.title} ${f.month_label ?? ''}`.toLowerCase().includes(needle))
  const pinned = shown.filter((f) => favs.includes(f.id))
  const rest = shown.filter((f) => !favs.includes(f.id))
  const groups: Record<string, FileRow[]> = {}
  rest.forEach((f) => {
    const k = settings.group_by_month ? f.month_label || 'Other' : ''
    ;(groups[k] = groups[k] ?? []).push(f)
  })

  const name = firstName(profile?.full_name, profile?.email)
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const teams = profile?.teams ?? []

  const row = (f: FileRow) => {
    const inner = (
      <>
        <div className="meta">
          <strong>{f.title}</strong>
          {isNew(f) && <span className="badge pulse">New</span>}
        </div>
        <span className="muted">{f.month_label ?? ''}</span>
      </>
    )
    return (
      <div className="file-row" key={f.id}>
        {f.kind === 'gsheet' ? (
          <Link className="file-item" to={`/file/${f.id}`}>{inner}</Link>
        ) : (
          <a className="file-item" href={f.url ?? '#'} target="_blank" rel="noopener noreferrer">{inner}</a>
        )}
        <button className={`star${favs.includes(f.id) ? ' on' : ''}`} onClick={() => toggleFav(f)} title="Pin file" aria-label="Pin file">
          {favs.includes(f.id) ? '★' : '☆'}
        </button>
      </div>
    )
  }

  return (
    <>
      <Hero name={name} subtitle={`${today} · welcome back`} canUpload={false} />

      {teams.length > 0 && (
        <div className="row" style={{ marginBottom: '1rem', gap: '0.4rem' }}>
          {teams.map((t) => (
            <span key={t} className="badge">{t}</span>
          ))}
        </div>
      )}

      <div className="grid metrics stagger" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <div className="muted">Files for you</div>
          <div className="metric-value">{files.length}</div>
        </div>
        <div className="card">
          <div className="muted">New this week</div>
          <div className="metric-value">{files.filter(isNew).length}</div>
        </div>
        <Link className="card" to="/schedule" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div className="muted">My schedule</div>
          <div className="metric-value" style={{ fontSize: '1.4rem' }}>Open →</div>
        </Link>
      </div>

      <Announcements canPost={false} />

      {settings.show_search && (
        <input placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: '0.5rem 0 0.25rem' }} />
      )}

      {busy && (
        <>
          <div className="skeleton" />
          <div className="skeleton" />
        </>
      )}
      {!busy && shown.length === 0 && <p className="muted">No files to show.</p>}

      {pinned.length > 0 && (
        <>
          <div className="section-title">Pinned</div>
          {pinned.map(row)}
        </>
      )}
      {Object.entries(groups).map(([k, list]) => (
        <div key={k}>
          <div className="section-title">{k || 'All files'}</div>
          {list.map(row)}
        </div>
      ))}
    </>
  )
}
