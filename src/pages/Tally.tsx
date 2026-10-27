
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Department = {
  id: string
  code: string
  name: string
  active: boolean
}

type Team = {
  id: string
  department_id: string
  code: string
  name: string
  active: boolean
}

type DailyRecord = {
  team_id: string
  work_date: string
  daily_count: number
}

type MonthlyRecord = {
  team_id: string
  month_start: string
  wid: number
  mid: number
}

type MonthlyTotal = {
  wid: string
  mid: string
}

const getCurrentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const getMonthDates = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number)
  const days = new Date(year, monthNumber, 0).getDate()

  return Array.from({ length: days }, (_, index) =>
    `${month}-${String(index + 1).padStart(2, '0')}`
  )
}

const dailyKey = (teamId: string, date: string) => `${teamId}|${date}`

export default function Tally() {
  const { profile } = useAuth()

  const canEdit =
    profile?.active === true &&
    (profile.role === 'owner' || profile.role === 'editor')

  const [departments, setDepartments] = useState<Department[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [departmentId, setDepartmentId] = useState('')
  const [month, setMonth] = useState(getCurrentMonth)
  const [dailyCounts, setDailyCounts] = useState<Record<string, string>>({})
  const [monthlyTotals, setMonthlyTotals] = useState<Record<string, MonthlyTotal>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const dates = useMemo(() => getMonthDates(month), [month])
  const monthStart = `${month}-01`
  const monthEnd = dates[dates.length - 1]

  const activeTeams = useMemo(
    () => teams
      .filter(team => team.active && team.department_id === departmentId)
      .sort((a, b) => a.code.localeCompare(b.code)),
    [teams, departmentId]
  )

  const loadBoard = useCallback(async () => {
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const [departmentResult, teamResult] = await Promise.all([
        supabase.from('installation_departments')
          .select('id,code,name,active')
          .order('code'),
        supabase.from('installation_teams')
          .select('id,department_id,code,name,active')
          .order('code')
      ])

      if (departmentResult.error) throw departmentResult.error
      if (teamResult.error) throw teamResult.error

      const departmentRows = (departmentResult.data ?? []) as Department[]
      const teamRows = (teamResult.data ?? []) as Team[]

      setDepartments(departmentRows)
      setTeams(teamRows)

      const selectedDepartment =
        departmentRows.find(item => item.id === departmentId && item.active) ??
        departmentRows.find(item => item.code === 'SLI' && item.active) ??
        departmentRows.find(item => item.active)

      if (!selectedDepartment) {
        setDepartmentId('')
        setDailyCounts({})
        setMonthlyTotals({})
        return
      }

      if (selectedDepartment.id !== departmentId) {
        setDepartmentId(selectedDepartment.id)
      }

      const teamIds = teamRows
        .filter(team => team.active && team.department_id === selectedDepartment.id)
        .map(team => team.id)

      if (teamIds.length === 0) {
        setDailyCounts({})
        setMonthlyTotals({})
        return
      }

      const [dailyResult, totalsResult] = await Promise.all([
        supabase.from('installation_daily_counts')
          .select('team_id,work_date,daily_count')
          .in('team_id', teamIds)
          .gte('work_date', monthStart)
          .lte('work_date', monthEnd),
        supabase.from('installation_monthly_totals')
          .select('team_id,month_start,wid,mid')
          .in('team_id', teamIds)
          .eq('month_start', monthStart)
      ])

      if (dailyResult.error) throw dailyResult.error
      if (totalsResult.error) throw totalsResult.error

      const nextDaily: Record<string, string> = {}
      ;((dailyResult.data ?? []) as DailyRecord[]).forEach(row => {
        nextDaily[dailyKey(row.team_id, row.work_date)] = String(row.daily_count)
      })

      const nextTotals: Record<string, MonthlyTotal> = {}
      ;((totalsResult.data ?? []) as MonthlyRecord[]).forEach(row => {
        nextTotals[row.team_id] = {
          wid: String(row.wid),
          mid: String(row.mid)
        }
      })

      setDailyCounts(nextDaily)
      setMonthlyTotals(nextTotals)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the tally board.')
    } finally {
      setLoading(false)
    }
  }, [departmentId, monthStart, monthEnd])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  function changeMonth(offset: number) {
    const [year, monthNumber] = month.split('-').map(Number)
    const next = new Date(year, monthNumber - 1 + offset, 1)

    setMonth(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
    )
  }

  function updateDaily(teamId: string, date: string, value: string) {
    if (value !== '' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) return

    setDailyCounts(current => ({
      ...current,
      [dailyKey(teamId, date)]: value
    }))
  }

  function updateMonthly(teamId: string, field: 'wid' | 'mid', value: string) {
    if (value !== '' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) return

    setMonthlyTotals(current => ({
      ...current,
      [teamId]: {
        wid: current[teamId]?.wid ?? '',
        mid: current[teamId]?.mid ?? '',
        [field]: value
      }
    }))
  }

  async function saveDaily(teamId: string, date: string) {
    if (!canEdit) return

    const key = dailyKey(teamId, date)
    const count = (dailyCounts[key] ?? '') === '' ? 0 : Number(dailyCounts[key])

    if (!Number.isSafeInteger(count) || count < 0) {
      setError('Daily counts must be whole numbers of zero or more.')
      return
    }

    setSaving(key)
    setError('')
    setMessage('')

    try {
      const { error: saveError } = await supabase
        .from('installation_daily_counts')
        .upsert({
          team_id: teamId,
          work_date: date,
          daily_count: count,
          updated_at: new Date().toISOString(),
          updated_by: profile?.id
        }, { onConflict: 'team_id,work_date' })

      if (saveError) throw saveError

      setDailyCounts(current => ({
        ...current,
        [key]: String(count)
      }))
      setMessage(`Saved day ${Number(date.slice(8))}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not save ${date}.`)
    } finally {
      setSaving(null)
    }
  }

  async function saveMonthly(teamId: string, field: 'wid' | 'mid') {
    if (!canEdit) return

    const current = monthlyTotals[teamId] ?? { wid: '', mid: '' }
    const raw = current[field]
    const count = raw === '' ? 0 : Number(raw)
    const savingKey = `${teamId}|${field}`

    if (!Number.isSafeInteger(count) || count < 0) {
      setError('WID and MID must be whole numbers of zero or more.')
      return
    }

    setSaving(savingKey)
    setError('')
    setMessage('')

    try {
      const { error: saveError } = await supabase
        .from('installation_monthly_totals')
        .upsert({
          team_id: teamId,
          month_start: monthStart,
          wid: field === 'wid' ? count : Number(current.wid || 0),
          mid: field === 'mid' ? count : Number(current.mid || 0),
          updated_at: new Date().toISOString(),
          updated_by: profile?.id
        }, { onConflict: 'team_id,month_start' })

      if (saveError) throw saveError

      setMonthlyTotals(previous => ({
        ...previous,
        [teamId]: { ...current, [field]: String(count) }
      }))
      setMessage(`${field.toUpperCase()} saved.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not save ${field}.`)
    } finally {
      setSaving(null)
    }
  }

  const departmentWid = activeTeams.reduce(
    (sum, team) => sum + Number(monthlyTotals[team.id]?.wid || 0),
    0
  )

  const departmentMid = activeTeams.reduce(
    (sum, team) => sum + Number(monthlyTotals[team.id]?.mid || 0),
    0
  )

  function exportCsv() {
    const escapeCsv = (value: string | number) =>
      `"${String(value).replace(/"/g, '""')}"`

    const rows: (string | number)[][] = [
      ['Team', ...dates.map(date => Number(date.slice(8))), 'WID', 'MID']
    ]

    activeTeams.forEach(team => {
      rows.push([
        team.code,
        ...dates.map(date =>
          Number(dailyCounts[dailyKey(team.id, date)] || 0)
        ),
        Number(monthlyTotals[team.id]?.wid || 0),
        Number(monthlyTotals[team.id]?.mid || 0)
      ])
    })

    const csv = rows.map(row => row.map(escapeCsv).join(',')).join('\r\n')
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    )

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download =
      `installation-tally-${month}-${departments.find(item => item.id === departmentId)?.code ?? 'department'}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const cellInputStyle: CSSProperties = {
    width: '100%',
    minWidth: 0,
    minHeight: '42px',
    boxSizing: 'border-box',
    padding: '0.45rem 0.3rem',
    textAlign: 'center',
    border: '1px solid transparent',
    borderRadius: '7px',
    background: 'transparent',
    color: 'inherit',
    fontSize: '0.95rem',
    fontWeight: 500,
    outlineOffset: '-1px'
  }

  function handleCellKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    teamIndex: number,
    dateIndex: number
  ) {
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) return

    event.preventDefault()

    const nextTeamIndex = event.key === 'ArrowUp'
      ? Math.max(0, teamIndex - 1)
      : Math.min(activeTeams.length - 1, teamIndex + 1)

    const nextTeam = activeTeams[nextTeamIndex]
    const nextDate = dates[dateIndex]

    if (!nextTeam) return

    const nextInput = document.querySelector<HTMLInputElement>(
      `[data-tally-key="${dailyKey(nextTeam.id, nextDate)}"]`
    )

    nextInput?.focus()
    nextInput?.select()
  }

  return (
    <section className="tally-page">
      <style>{`
        .tally-page {
          --tally-accent: var(--accent, #956b25);
          --tally-border: var(--border, #e8dcc6);
          --tally-card: var(--card, #fffdf8);
          --tally-soft: var(--surface, #f7f1e6);
        }

        .tally-page .tally-toolbar {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) minmax(260px, 1fr);
          gap: 1rem;
          align-items: end;
        }

        .tally-page .tally-scroll {
          overflow: auto;
          max-width: 100%;
          max-height: 72vh;
          border: 1px solid var(--tally-border);
          border-radius: 14px;
          background: var(--tally-card);
          scrollbar-gutter: stable;
        }

        .tally-page .tally-table {
          border-collapse: separate;
          border-spacing: 0;
          width: max-content;
          min-width: 100%;
          font-size: 0.95rem;
        }

        .tally-page .tally-table th,
        .tally-page .tally-table td {
          border-bottom: 1px solid var(--tally-border);
          border-right: 1px solid rgba(140, 110, 65, 0.07);
        }

        .tally-page .tally-table td {
          min-width: 66px;
          padding: 5px;
          text-align: center;
        }

        .tally-page .tally-table thead th {
          position: sticky;
          top: 0;
          z-index: 3;
          height: 48px;
          padding: 0.75rem 0.5rem;
          background: var(--tally-soft);
          color: var(--tally-accent);
          text-align: center;
          font-weight: 700;
          white-space: nowrap;
        }

        .tally-page .tally-table thead th:first-child {
          left: 0;
          z-index: 5;
          min-width: 160px;
          text-align: left;
        }

        .tally-page .tally-table thead th:nth-last-child(-n+2) {
          min-width: 94px;
          background: rgba(149, 107, 37, 0.12);
        }

        .tally-page .tally-table tbody th:first-child {
          position: sticky;
          left: 0;
          z-index: 2;
          min-width: 160px;
          padding: 0.65rem 0.9rem;
          background: var(--tally-card);
          color: var(--tally-accent);
          text-align: left;
          white-space: nowrap;
          font-weight: 700;
        }

        .tally-page .tally-table tbody tr:nth-child(even) td {
          background: rgba(149, 107, 37, 0.035);
        }

        .tally-page .tally-table tbody tr:hover td {
          background: rgba(149, 107, 37, 0.075);
        }

        .tally-page .tally-table tbody tr:hover th:first-child {
          background: var(--tally-soft);
        }

        .tally-page .tally-table input {
          transition: background 120ms ease, border-color 120ms ease;
        }

        .tally-page .tally-table input:hover {
          background: var(--tally-soft) !important;
          border-color: var(--tally-border) !important;
        }

        .tally-page .tally-table input:focus {
          background: var(--tally-card) !important;
          border-color: var(--tally-accent) !important;
          outline: 2px solid var(--tally-accent);
        }

        .tally-page .tally-table input:disabled {
          opacity: 1;
          cursor: default;
        }

        .tally-page .tally-table td:nth-last-child(-n+2) {
          background: rgba(149, 107, 37, 0.045);
        }

        .tally-page .tally-table td:nth-last-child(-n+2) input {
          font-weight: 700;
          color: var(--tally-accent);
        }

        .tally-page .tally-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .tally-page .tally-summary-card {
          border: 1px solid var(--tally-border);
          border-radius: 15px;
          padding: 1.1rem 1.25rem;
          background: var(--tally-card);
          box-shadow: 0 5px 20px rgba(70, 48, 15, 0.035);
        }

        .tally-page .tally-summary-number {
          margin-top: 0.35rem;
          font-size: 1.8rem;
          font-weight: 750;
          line-height: 1.2;
          color: var(--tally-accent);
          font-variant-numeric: tabular-nums;
        }

        .tally-page .tally-month-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          margin-bottom: 1rem;
        }

        @media (max-width: 760px) {
          .tally-page .tally-toolbar {
            grid-template-columns: 1fr;
          }

          .tally-page .tally-summary {
            grid-template-columns: 1fr 1fr;
          }

          .tally-page .tally-summary-card:last-child {
            grid-column: 1 / -1;
          }

          .tally-page .tally-scroll {
            max-height: 68vh;
          }

          .tally-page .tally-table {
            font-size: 0.9rem;
          }

          .tally-page .tally-table td {
            min-width: 62px;
          }
        }
      `}</style>

      <div className="page-head">
        <div>
          <h1>Installation Tally</h1>
          <p className="muted" style={{ margin: 0 }}>
            Monthly installation performance by team
          </p>
        </div>

        <button
          type="button"
          className="btn"
          onClick={exportCsv}
          disabled={loading || activeTeams.length === 0}
        >
          Export CSV
        </button>
      </div>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="tally-toolbar">
          <label>
            Department
            <select
              value={departmentId}
              onChange={event => setDepartmentId(event.target.value)}
            >
              {departments
                .filter(department => department.active)
                .sort((a, b) =>
                  a.code === 'SLI' ? -1 :
                  b.code === 'SLI' ? 1 :
                  a.code.localeCompare(b.code)
                )
                .map(department => (
                  <option key={department.id} value={department.id}>
                    {department.code} — {department.name}
                  </option>
                ))}
            </select>
          </label>

          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem' }}>
              Reporting month
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn"
                aria-label="Previous month"
                onClick={() => changeMonth(-1)}
              >
                ←
              </button>

              <input
                type="month"
                value={month}
                onChange={event => {
                  if (event.target.value) setMonth(event.target.value)
                }}
                style={{ flex: 1, minWidth: 0 }}
              />

              <button
                type="button"
                className="btn"
                aria-label="Next month"
                onClick={() => changeMonth(1)}
              >
                →
              </button>
            </div>
          </div>
        </div>

        <p className="muted" style={{ marginBottom: 0, marginTop: '1rem', fontSize: '0.88rem' }}>
          {canEdit
            ? 'Select a daily value to edit it. Changes save when you leave the cell. Use Enter or the up/down arrows to move between teams.'
            : 'Read-only view. Contact an owner or editor to update counts.'}
        </p>
      </div>

      <div className="tally-summary">
        <div className="tally-summary-card">
          <div className="muted">Department WID</div>
          <div className="tally-summary-number">
            {departmentWid.toLocaleString()}
          </div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Total across active teams
          </div>
        </div>

        <div className="tally-summary-card">
          <div className="muted">Department MID</div>
          <div className="tally-summary-number">
            {departmentMid.toLocaleString()}
          </div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Total across active teams
          </div>
        </div>

        <div className="tally-summary-card">
          <div className="muted">Active teams</div>
          <div className="tally-summary-number">
            {activeTeams.length}
          </div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            In the selected department
          </div>
        </div>
      </div>

      <div className="card">
        <div className="tally-month-title">
          <div>
            <h2 style={{ margin: 0 }}>
              {departments.find(item => item.id === departmentId)?.code ?? 'Department'}
              {' — '}
              {new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric'
              })}
            </h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              Daily counts by team
            </p>
          </div>

          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {dates.length} days · scroll horizontally
          </span>
        </div>

        {loading ? (
          <p className="muted">Loading monthly board…</p>
        ) : activeTeams.length === 0 ? (
          <div className="empty">
            No active teams in this department. Add teams in Team Settings first.
          </div>
        ) : (
          <div className="tally-scroll">
            <table className="tally-table">
              <thead>
                <tr>
                  <th>Team</th>

                  {dates.map(date => (
                    <th key={date}>
                      {Number(date.slice(8))}
                    </th>
                  ))}

                  <th>WID</th>
                  <th>MID</th>
                </tr>
              </thead>

              <tbody>
                {activeTeams.map((team, teamIndex) => (
                  <tr key={team.id}>
                    <th scope="row">{team.code}</th>

                    {dates.map((date, dateIndex) => {
                      const key = dailyKey(team.id, date)

                      return (
                        <td key={date}>
                          <input
                            className="tally-cell"
                            data-tally-key={key}
                            aria-label={`${team.code} count for ${date}`}
                            title={`${team.code} · ${date}`}
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            disabled={!canEdit}
                            value={dailyCounts[key] ?? ''}
                            placeholder="0"
                            onChange={event =>
                              updateDaily(team.id, date, event.target.value)
                            }
                            onBlur={() => void saveDaily(team.id, date)}
                            onKeyDown={event =>
                              handleCellKeyDown(event, teamIndex, dateIndex)
                            }
                            style={cellInputStyle}
                          />
                          {saving === key && (
                            <span style={{ fontSize: '0.7rem' }}>Saving…</span>
                          )}
                        </td>
                      )
                    })}

                    {(['wid', 'mid'] as const).map(field => {
                      const key = `${team.id}|${field}`

                      return (
                        <td key={field}>
                          <input
                            className="tally-cell"
                            aria-label={`${team.code} ${field.toUpperCase()} total`}
                            title={`${team.code} ${field.toUpperCase()}`}
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            disabled={!canEdit}
                            value={monthlyTotals[team.id]?.[field] ?? ''}
                            placeholder="0"
                            onChange={event =>
                              updateMonthly(team.id, field, event.target.value)
                            }
                            onBlur={() => void saveMonthly(team.id, field)}
                            style={cellInputStyle}
                          />
                          {saving === key && (
                            <span style={{ fontSize: '0.7rem' }}>Saving…</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="muted" style={{ fontSize: '0.83rem', marginBottom: 0, marginTop: '1rem' }}>
          WID and MID totals above are calculated from the team-level WID and MID entries.
          Daily counts are recorded separately. Blank daily cells are treated as zero in exports.
        </p>
      </div>
    </section>
  )
}
