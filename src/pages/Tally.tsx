
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const TEAMS = ['SLI', 'MIG/OSP', 'SLR', 'QA', 'OMT'] as const
type Team = (typeof TEAMS)[number]

type Entry = {
  id: string
  installation_date: string
  team: Team
  wid: number
  mid: number
  notes: string | null
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const monthStart = () => `${today().slice(0, 7)}-01`

export default function Tally() {
  const { profile } = useAuth()
  const canEdit = profile?.active === true &&
    (profile.role === 'owner' || profile.role === 'editor')

  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [teamFilter, setTeamFilter] = useState('all')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(today)
  const [team, setTeam] = useState<Team>('SLI')
  const [wid, setWid] = useState('0')
  const [mid, setMid] = useState('0')
  const [notes, setNotes] = useState('')
  const [editId, setEditId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    let query = supabase
      .from('installation_tally')
      .select('id,installation_date,team,wid,mid,notes')
      .gte('installation_date', from)
      .lte('installation_date', to)
      .order('installation_date', { ascending: false })
      .order('team', { ascending: true })

    if (teamFilter !== 'all') query = query.eq('team', teamFilter)

    const { data, error: fetchError } = await query

    if (fetchError) {
      setError(fetchError.message)
      setEntries([])
    } else {
      setEntries((data ?? []) as Entry[])
    }

    setLoading(false)
  }, [from, to, teamFilter])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => entries.reduce(
    (sum, e) => ({ wid: sum.wid + e.wid, mid: sum.mid + e.mid }),
    { wid: 0, mid: 0 }
  ), [entries])

  const teamTotals = useMemo(() => TEAMS.map((name) => {
    const rows = entries.filter((e) => e.team === name)
    return {
      team: name,
      wid: rows.reduce((s, e) => s + e.wid, 0),
      mid: rows.reduce((s, e) => s + e.mid, 0),
      days: rows.length
    }
  }), [entries])

  function startNew() {
    setEditId(null)
    setDate(today())
    setTeam(TEAMS[0])
    setWid('0')
    setMid('0')
    setNotes('')
    setMessage('')
    setEditing(true)
  }

  function startEdit(entry: Entry) {
    if (!canEdit) return
    setEditId(entry.id)
    setDate(entry.installation_date)
    setTeam(entry.team)
    setWid(String(entry.wid))
    setMid(String(entry.mid))
    setNotes(entry.notes ?? '')
    setMessage('')
    setEditing(true)
  }

  async function save() {
    if (!canEdit) return

    const w = Number(wid)
    const m = Number(mid)

    if (!date || !Number.isInteger(w) || !Number.isInteger(m) || w < 0 || m < 0) {
      setError('Enter a valid date and whole-number WID/MID counts of zero or more.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    const payload = {
      installation_date: date,
      team,
      wid: w,
      mid: m,
      notes: notes.trim() || null,
      updated_by: profile.id,
      ...(editId ? {} : { created_by: profile.id })
    }

    const result = await supabase
      .from('installation_tally')
      .upsert(payload, { onConflict: 'installation_date,team' })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setEditing(false)
    setMessage('Tally saved.')
    await load()
  }

  async function remove(entry: Entry) {
    if (!canEdit || profile?.role !== 'owner') return
    if (!window.confirm(`Delete ${entry.team} tally for ${entry.installation_date}?`)) return

    setError('')
    setMessage('')

    const { error: deleteError } = await supabase
      .from('installation_tally')
      .delete()
      .eq('id', entry.id)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setMessage('Entry deleted.')
    await load()
  }

  function exportCsv() {
    const csvCell = (v: string | number | null) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`

    const rows = [
      ['Installation date', 'Team', 'WID', 'MID', 'Notes'],
      ...entries.map((e) => [
        e.installation_date, e.team, e.wid, e.mid, e.notes ?? ''
      ])
    ]

    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `installation-tally-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Installation Tally</h1>
          <p className="muted" style={{ margin: 0 }}>
            Daily team counts for WID and MID
          </p>
        </div>
        {canEdit && (
          <button className="btn primary" onClick={startNew}>
            + Add tally
          </button>
        )}
      </div>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <div className="grid metrics" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <div className="muted">Total WID</div>
          <div className="metric-value">{totals.wid.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="muted">Total MID</div>
          <div className="metric-value">{totals.mid.toLocaleString()}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2>Filters</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
          <label>
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Team
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="all">All teams</option>
              {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn" onClick={exportCsv} disabled={entries.length === 0}>
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {editing && canEdit && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2>{editId ? 'Edit tally' : 'Add daily tally'}</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            <label>
              Installation date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Team
              <select value={team} onChange={(e) => setTeam(e.target.value as Team)}>
                {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              WID
              <input type="number" min="0" step="1" value={wid} onChange={(e) => setWid(e.target.value)} />
            </label>
            <label>
              MID
              <input type="number" min="0" step="1" value={mid} onChange={(e) => setMid(e.target.value)} />
            </label>
          </div>
          <label style={{ display: 'block', marginTop: '0.75rem' }}>
            Notes (optional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save tally'}
            </button>
            <button className="btn" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2>Team totals</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.65rem' }}>Team</th>
                <th style={{ textAlign: 'right', padding: '0.65rem' }}>WID</th>
                <th style={{ textAlign: 'right', padding: '0.65rem' }}>MID</th>
                <th style={{ textAlign: 'right', padding: '0.65rem' }}>Days recorded</th>
              </tr>
            </thead>
            <tbody>
              {teamTotals.map((t) => (
                <tr key={t.team} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.65rem' }}>{t.team}</td>
                  <td style={{ textAlign: 'right', padding: '0.65rem' }}>{t.wid.toLocaleString()}</td>
                  <td style={{ textAlign: 'right', padding: '0.65rem' }}>{t.mid.toLocaleString()}</td>
                  <td style={{ textAlign: 'right', padding: '0.65rem' }}>{t.days}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td style={{ padding: '0.65rem' }}>Total</td>
                <td style={{ textAlign: 'right', padding: '0.65rem' }}>{totals.wid.toLocaleString()}</td>
                <td style={{ textAlign: 'right', padding: '0.65rem' }}>{totals.mid.toLocaleString()}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Daily records</h2>
        {loading && <p className="muted">Loading tally…</p>}
        {!loading && entries.length === 0 && (
          <div className="empty">No tally records for this date range yet.</div>
        )}
        {entries.map((e) => (
          <div key={e.id} style={{ padding: '0.8rem 0', borderBottom: '1px solid var(--border)' }}>
            <div className="row between" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
              <div>
                <strong>{e.team}</strong>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {e.installation_date}
                </div>
              </div>
              <div className="row" style={{ gap: '0.75rem' }}>
                <span>WID <strong>{e.wid}</strong></span>
                <span>MID <strong>{e.mid}</strong></span>
              </div>
            </div>
            {e.notes && <p className="muted" style={{ margin: '0.4rem 0' }}>{e.notes}</p>}
            {canEdit && (
              <div className="row" style={{ marginTop: '0.5rem', gap: '0.4rem' }}>
                <button className="btn small" onClick={() => startEdit(e)}>Edit</button>
                {profile?.role === 'owner' && (
                  <button className="btn small" onClick={() => void remove(e)}>Delete</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
