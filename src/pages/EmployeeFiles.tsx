import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useNotifs } from '../lib/notifications'
import type { DashSettings } from '../lib/settings'
import type { FileRow } from '../types'
import '../components/tabs.css'

const WEEK = 7 * 864e5

export default function EmployeeFiles({ settings }: { settings: DashSettings }) {
  const { profile } = useAuth()
  const { items } = useNotifs()
  const [files, setFiles] = useState<FileRow[]>([])
  const [added, setAdded] = useState<Record<string, string>>({})
  const [favs, setFavs] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    ;(async () => {
      const [f, a, v] = await Promise.all([
        supabase.from('files').select('*').order('created_at', { ascending: false }),
        supabase.from('assignments').select('file_id,created_at'),
        supabase.from('favorites').select('file_id')
      ])
      if (f.error) setErr('Could not load your files.')
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

  const updated = new Set(items.filter((n) => !n.read_at && n.file_id).map((n) => n.file_id))
  const isNew = (f: FileRow) => !!added[f.id] && Date.now() - new Date(added[f.id]).getTime() < WEEK
  const needle = q.trim().toLowerCase()
  const shown = files.filter((f) => !needle || `${f.title} ${f.month_label ?? ''}`.toLowerCase().includes(needle))

  const row = (f: FileRow) => {
    const inner = (
      <>
        <div className="meta">
          <strong>{f.title}</strong>
          <span className="row" style={{ gap: '0.3rem' }}>
            {updated.has(f.id) && <span className="badge pulse">Updated</span>}
            {isNew(f) && <span className="badge">New</span>}
          </span>
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
        <button className={`star${favs.includes(f.id) ? ' on' : ''}`} onClick={() => toggleFav(f)} aria-label="Pin file">
          {favs.includes(f.id) ? '★' : '☆'}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="page-head"><h1>{settings.welcome || 'Files'}</h1></div>
      {settings.show_search && <input placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '0.75rem' }} />}
      {err && <div className="notice error">{err}</div>}
      {busy && (
        <>
          <div className="skeleton" />
          <div className="skeleton" />
        </>
      )}
      {!busy && shown.length === 0 && <div className="empty">No files to show.</div>}
      {shown.filter((f) => favs.includes(f.id)).length > 0 && <div className="section-title">Pinned</div>}
      {shown.filter((f) => favs.includes(f.id)).map(row)}
      <div className="section-title">All files</div>
      {shown.filter((f) => !favs.includes(f.id)).map(row)}
    </>
  )
}
