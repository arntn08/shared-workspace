import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { FileRow } from '../types'

export default function FileViewer() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [file, setFile] = useState<FileRow | null>(null)
  const [tabs, setTabs] = useState<string[]>([])
  const [tab, setTab] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)

  async function fetchSheet(t: string) {
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.functions.invoke('read-sheet', {
      body: { fileId: id, tab: t || undefined }
    })
    if (error || !data || data.error) {
      setErr('Could not load this spreadsheet.')
      setBusy(false)
      return
    }
    setTabs(data.tabs)
    setTab(data.tab)
    setRows(data.rows)
    setBusy(false)
  }

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.from('files').select('*').eq('id', id).maybeSingle()
      setFile(data as FileRow | null)
      if (data && data.kind === 'gsheet') await fetchSheet('')
      else setBusy(false)
    })()
  }, [id])

  const back = profile?.role === 'owner' ? '/files' : '/'
  const header = rows[0] ?? []
  const width = Math.max(0, ...rows.map((r) => r.length))
  const body = rows.slice(1).filter((r) => !q || r.join(' ').toLowerCase().includes(q.toLowerCase()))
  const shown = body.slice(0, 1000)
  const locked = profile?.role !== 'owner'

  return (
    <>
      <p><Link to={back}>← Back</Link></p>
      {!busy && !file && <p className="error">File not found or not available to you.</p>}
      {file && <h1>{file.title}</h1>}
      {file && file.kind !== 'gsheet' && file.url && (
        <p><a href={file.url} target="_blank" rel="noopener noreferrer">Open this file</a></p>
      )}
      {busy && <p className="muted">Loading…</p>}
      {err && <p className="error">{err}</p>}
      {file?.kind === 'gsheet' && !busy && !err && (
        <>
          <div className="notice">View only. Changes to the original sheet appear here automatically.</div>
          {tabs.length > 1 && (
            <select value={tab} onChange={(e) => fetchSheet(e.target.value)} style={{ marginBottom: '0.75rem' }}>
              {tabs.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          <input placeholder="Search this sheet" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '0.75rem' }} />
          <div
            className="table-wrap"
            style={locked ? { userSelect: 'none', WebkitUserSelect: 'none' } : undefined}
            onContextMenu={locked ? (e) => e.preventDefault() : undefined}
          >
            <table>
              <thead>
                <tr>
                  {Array.from({ length: width }).map((_, i) => (
                    <th key={i}>{header[i] ?? ''}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, ri) => (
                  <tr key={ri}>
                    {Array.from({ length: width }).map((_, ci) => (
                      <td key={ci}>{r[ci] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {body.length > shown.length && <p className="muted">Showing the first 1000 matching rows. Use search to narrow down.</p>}
        </>
      )}
    </>
  )
}
