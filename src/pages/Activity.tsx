import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { actionKind, actionLabel, detailText } from '../lib/labels'

type Filter = 'all' | 'view' | 'edit' | 'admin'
const filters: [Filter, string][] = [
  ['all', 'All'],
  ['view', 'Sign-ins & views'],
  ['edit', 'Edits'],
  ['admin', 'Admin']
]

export default function Activity() {
  const [rows, setRows] = useState<any[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    supabase
      .from('audit_logs')
      .select('id,action,detail,created_at,profiles(email)')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data }) => {
        setRows(data ?? [])
        setBusy(false)
      })
  }, [])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (filter === 'all' || actionKind(r.action) === filter) &&
        (!t || String(r.profiles?.email ?? '').toLowerCase().includes(t) || detailText(r.detail).toLowerCase().includes(t))
    )
  }, [rows, filter, q])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="muted" style={{ margin: 0 }}>The latest 300 sign-ins, file views, edits, and admin actions.</p>
        </div>
      </div>
      <div className="chips">
        {filters.map(([k, label]) => (
          <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      <input placeholder="Search by person or detail" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '0.75rem' }} />
      {busy && <p className="muted">Loading…</p>}
      {!busy && shown.length === 0 && <p className="muted">Nothing to show.</p>}
      {shown.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.profiles?.email ?? 'unknown'}</td>
                  <td><span className={`badge ${actionKind(r.action)}`}>{actionLabel(r.action)}</span></td>
                  <td style={{ whiteSpace: 'normal' }}>{detailText(r.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
