import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { FileRow } from '../types'

interface Section {
  title: string
  head: string[] | null
  rows: string[][]
}

const ERR = /^#(REF|N\/A|VALUE|DIV\/0|NAME|NULL|NUM|ERROR)[!?]?$/i
const NUM = /^[\d.,\s]+$/
const LABEL = /^(new install|migration|slr|total)$/i

const clean = (c: unknown) => {
  const s = String(c ?? '')
  return ERR.test(s.trim()) ? '' : s
}
const filled = (c: string | undefined) => (c ?? '').trim() !== ''
const hl = (t: string | undefined) => (/new install|migration/i.test(t ?? '') ? 'hl' : undefined)

function isHeading(cells: string[]) {
  const text = cells.filter((c) => filled(c))
  if (text.length === 0) return false
  const first = text[0].trim()
  if (NUM.test(first) || /^total\b/i.test(first)) return false
  return text.slice(1).every((c) => NUM.test(c.trim()) || LABEL.test(c.trim()))
}

function parse(rows: string[][]) {
  let title = ''
  const sections: Section[] = []
  let cur: Section | null = null
  let expectHead = false
  for (const raw of rows) {
    const cells = (Array.isArray(raw) ? raw : []).map(clean)
    if (!cells.some((c) => filled(c))) continue
    if (isHeading(cells)) {
      const text = (cells.find((c) => filled(c)) ?? '').trim()
      if (!title && sections.length === 0) {
        title = text
        continue
      }
      cur = { title: text, head: null, rows: [] }
      sections.push(cur)
      expectHead = true
      continue
    }
    if (!cur) {
      cur = { title: '', head: null, rows: [] }
      sections.push(cur)
    }
    if (expectHead) {
      cur.head = cells
      expectHead = false
      continue
    }
    cur.rows.push(cells)
  }
  return { title, sections }
}

function usedCols(s: Section) {
  const max = Math.max(0, s.head?.length ?? 0, ...s.rows.map((r) => r.length))
  const cols: number[] = []
  for (let i = 0; i < max; i++) {
    if (filled(s.head?.[i]) || s.rows.some((r) => filled(r[i]))) cols.push(i)
  }
  return cols
}

function useNarrow() {
  const query = '(max-width: 720px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const f = () => setNarrow(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return narrow
}

export default function FileViewer() {
  const { id } = useParams()
  const { profile } = useAuth()
  const narrow = useNarrow()
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

  const parsed = useMemo(() => parse(rows), [rows])
  const query = q.trim().toLowerCase()
  const visible = useMemo(
    () =>
      parsed.sections
        .map((s) => ({
          ...s,
          rows:
            query && !s.title.toLowerCase().includes(query)
              ? s.rows.filter((r) => r.join(' ').toLowerCase().includes(query))
              : s.rows
        }))
        .filter((s) => !query || s.rows.length > 0),
    [parsed, query]
  )

  const back = profile?.role === 'employee' ? '/' : '/files'
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor'
  const locked = !canEdit

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
          <div className="notice">
            <span style={{ flex: 1 }}>View only. Updates from the original sheet appear here automatically.</span>
            {canEdit && file.url && (
              <a className="btn primary" href={file.url} target="_blank" rel="noopener noreferrer">
                Edit in Google Sheets
              </a>
            )}
          </div>

          <div className="row" style={{ marginBottom: '0.75rem' }}>
            {tabs.length > 1 && (
              <select value={tab} onChange={(e) => fetchSheet(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
                {tabs.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
            <input placeholder="Search this sheet" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
          </div>

          <div
            className="sheet-wrap"
            style={locked ? { userSelect: 'none', WebkitUserSelect: 'none' } : undefined}
            onContextMenu={locked ? (e) => e.preventDefault() : undefined}
          >
            {parsed.title && <div className="sheet-title">{parsed.title}</div>}
            {visible.map((s, si) => {
              const cols = usedCols(s)
              return (
                <section key={si} className="sheet-block">
                  {s.title && <div className="sheet-band">{s.title}</div>}
                  {narrow ? (
                    <div className="sheet-cards">
                      {s.rows.map((r, ri) => {
                        const first = cols.find((ci) => filled(r[ci]))
                        return (
                          <div key={ri} className="sheet-card">
                            <div className="sheet-card-title">{first !== undefined ? r[first] : ''}</div>
                            <div className="sheet-card-grid">
                              {cols
                                .filter((ci) => ci !== first && filled(r[ci]))
                                .map((ci) => (
                                  <div key={ci}>
                                    <span>{s.head?.[ci] ?? ''}</span>
                                    <b>{r[ci]}</b>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <table className="sheet-table">
                      {s.head && (
                        <thead>
                          <tr>
                            {cols.map((ci) => (
                              <th key={ci} className={hl(s.head?.[ci])}>{s.head?.[ci] ?? ''}</th>
                            ))}
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {s.rows.map((r, ri) => (
                          <tr key={ri}>
                            {cols.map((ci) => (
                              <td key={ci}>{r[ci] ?? ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              )
            })}
          </div>
          {visible.length === 0 && <p className="muted">Nothing matches your search.</p>}
        </>
      )}
    </>
  )
}
