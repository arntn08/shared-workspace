import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { DashSettings } from '../lib/settings'
import type { FileRow } from '../types'

function Item({ f }: { f: FileRow }) {
  const inner = (
    <>
      <strong>{f.title}</strong>
      <span className="muted">{f.month_label ?? ''}</span>
    </>
  )
  return f.kind === 'gsheet' ? (
    <Link className="file-item" to={`/file/${f.id}`}>{inner}</Link>
  ) : (
    <a className="file-item" href={f.url ?? '#'} target="_blank" rel="noopener noreferrer">{inner}</a>
  )
}

export default function EmployeeHome({ settings }: { settings: DashSettings }) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    supabase
      .from('files')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setFiles((data ?? []) as FileRow[])
        setBusy(false)
      })
  }, [])

  const shown = files.filter((f) => (f.title + ' ' + (f.month_label ?? '')).toLowerCase().includes(q.toLowerCase()))
  const groups: Record<string, FileRow[]> = {}
  shown.forEach((f) => {
    const k = settings.group_by_month ? f.month_label || 'Other' : ''
    groups[k] = groups[k] ?? []
    groups[k].push(f)
  })

  return (
    <>
      <h1>{settings.welcome}</h1>
      {settings.show_search && (
        <input placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: '0.75rem 0 1rem' }} />
      )}
      {busy && <p className="muted">Loading…</p>}
      {!busy && shown.length === 0 && <p className="muted">No files to show.</p>}
      {Object.entries(groups).map(([k, list]) => (
        <div key={k}>
          {k && <h2 style={{ marginTop: '1rem' }}>{k}</h2>}
          {list.map((f) => (
            <Item key={f.id} f={f} />
          ))}
        </div>
      ))}
    </>
  )
}
