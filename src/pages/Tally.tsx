
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

const formatDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getWeekStart = (dateString: string) => {
  const date = new Date(`${dateString}T12:00:00`)
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  return formatDate(date)
}

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const dates = useMemo(() => getMonthDates(month), [month])
  const monthStart = `${month}-01`
  const monthEnd = dates[dates.length - 1]

  const now = new Date()
  const currentMonth = getCurrentMonth()
  const reportDate =
    month === currentMonth
      ? formatDate(now) < monthEnd
        ? formatDate(now)
        : monthEnd
      : monthEnd

  const weekStart = getWeekStart(reportDate)

  const activeTeams = useMemo(
    () =>
      teams
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
        supabase
          .from('installation_departments')
          .select('id,code,name,active')
          .order('code'),
        supabase
          .from('installation_teams')
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
        departmentRows.find(
          item => item.id === departmentId && item.active
        ) ??
        departmentRows.find(
          item => item.code === 'SLI' && item.active
        ) ??
        departmentRows.find(item => item.active)

      if (!selectedDepartment) {
        setDepartmentId('')
        setDailyCounts({})
        return
      }

      if (selectedDepartment.id !== departmentId) {
        setDepartmentId(selectedDepartment.id)
      }

      const teamIds = teamRows
        .filter(
          team =>
            team.active &&
            team.department_id === selectedDepartment.id
        )
        .map(team => team.id)

      if (teamIds.length === 0) {
        setDailyCounts({})
        return
      }

      // Load the days before the first of the month when needed,
      // so WTD can include Monday-to-month-boundary dates.
      const [year, monthNumber] = month.split('-').map(Number)
      const firstOfMonth = new Date(year, monthNumber - 1, 1)
      const firstDayOfWeek = firstOfMonth.getDay()
      const daysBack = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1
      firstOfMonth.setDate(firstOfMonth.getDate() - daysBack)
      const queryStart = formatDate(firstOfMonth)

      const dailyResult = await supabase
        .from('installation_daily_counts')
        .select('team_id,work_date,daily_count')
        .in('team_id', teamIds)
        .gte('work_date', queryStart)
        .lte('work_date', monthEnd)

      if (dailyResult.error) throw dailyResult.error

      const nextDaily: Record<string, string> = {}

      ;((dailyResult.data ?? []) as DailyRecord[]).forEach(row => {
        nextDaily[dailyKey(row.team_id, row.work_date)] =
          String(row.daily_count)
      })

      setDailyCounts(nextDaily)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load the tally board.'
      )
    } finally {
      setLoading(false)
    }
  }, [departmentId, month, monthEnd])

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
    if (
      value !== '' &&
      (!/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)))
    ) {
      return
    }

    setDailyCounts(current => ({
      ...current,
      [dailyKey(teamId, date)]: value
    }))
  }

  async function saveDaily(teamId: string, date: string) {
    if (!canEdit) return

    const key = dailyKey(teamId, date)
    const raw = dailyCounts[key] ?? ''
    const count = raw === '' ? 0 : Number(raw)

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
        .upsert(
          {
            team_id: teamId,
            work_date: date,
            daily_count: count,
            updated_at: new Date().toISOString(),
            updated_by: profile?.id
          },
          { onConflict: 'team_id,work_date' }
        )

      if (saveError) throw saveError

      setDailyCounts(current => ({
        ...current,
        [key]: String(count)
      }))

      setMessage(`Saved ${date}. WTD and MTD have been recalculated.`)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Could not save ${date}.`
      )
    } finally {
      setSaving(null)
    }
  }

  function getCount(teamId: string, date: string) {
    return Number(dailyCounts[dailyKey(teamId, date)] || 0)
  }

  function getWTD(teamId: string) {
    return dates
      .filter(date => date >= weekStart && date <= reportDate)
      .reduce((sum, date) => sum + getCount(teamId, date), 0)
      // Include days from the preceding month if this reporting week
      // crosses a month boundary.
      + Object.entries(dailyCounts).reduce((sum, [key, value]) => {
        const separator = key.lastIndexOf('|')
        const id = key.slice(0, separator)
        const date = key.slice(separator + 1)

        if (
          id === teamId &&
          date >= weekStart &&
          date < monthStart &&
          date <= reportDate
        ) {
          return sum + Number(value || 0)
        }

        return sum
      }, 0)
  }

  function getMTD(teamId: string) {
    return dates
      .filter(date => date >= monthStart && date <= reportDate)
      .reduce((sum, date) => sum + getCount(teamId, date), 0)
  }

  const departmentWTD = activeTeams.reduce(
    (sum, team) => sum + getWTD(team.id),
    0
  )

  const departmentMTD = activeTeams.reduce(
    (sum, team) => sum + getMTD(team.id),
    0
  )

  const departmentDailyTotals = useMemo(
    () =>
      dates.map(date =>
        activeTeams.reduce(
          (sum, team) => sum + getCount(team.id, date),
          0
        )
      ),
    [dates, activeTeams, dailyCounts]
  )

  function exportCsv() {
    const escapeCsv = (value: string | number) =>
      `"${String(value).replace(/"/g, '""')}"`

    const rows: (string | number)[][] = [
      ['Team', ...dates.map(date => Number(date.slice(8))), 'WTD', 'MTD']
    ]

    activeTeams.forEach(team => {
      rows.push([
        team.code,
        ...dates.map(date => getCount(team.id, date)),
        getWTD(team.id),
        getMTD(team.id)
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
    minHeight: '54px',
    boxSizing: 'border-box',
    padding: '0.65rem 0.4rem',
    textAlign: 'center',
    border: '1px solid #e0d0b3',
    borderRadius: '10px',
    background: '#fffdf8',
    color: '#30291e',
    fontSize: '1.1rem',
    fontWeight: 600,
    outlineOffset: '-1px'
  }

  function handleCellKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    teamIndex: number,
    dateIndex: number
  ) {
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) return

    event.preventDefault()

    const nextTeamIndex =
      event.key === 'ArrowUp'
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
          color: var(--text, #30291e);
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
          max-height: 75vh;
          border: 1px solid var(--tally-border);
          border-radius: 16px;
          background: var(--tally-card);
          scrollbar-gutter: stable;
        }

        .tally-page .tally-table {
          border-collapse: separate;
          border-spacing: 0;
          width: max-content;
          min-width: 100%;
          font-size: 1rem;
        }

        .tally-page .tally-table th,
        .tally-page .tally-table td {
          border-bottom: 1px solid var(--tally-border);
          border-right: 1px solid rgba(140, 110, 65, 0.12);
        }

        .tally-page .tally-table thead th {
          position: sticky;
          top: 0;
          z-index: 3;
          min-width: 84px;
          height: 60px;
          padding: 1rem 0.75rem;
          background: #efe2c9;
          color: #674615;
          text-align: center;
          font-size: 1.05rem;
          font-weight: 800;
          white-space: nowrap;
        }

        .tally-page .tally-table thead th:first-child {
          left: 0;
          z-index: 5;
          min-width: 210px;
          text-align: left;
          background: #dfc797;
          color: #503510;
        }

        .tally-page .tally-table thead th:nth-last-child(-n+2) {
          min-width: 120px;
          background: #956b25;
          color: white;
        }

        .tally-page .tally-table tbody th:first-child {
          position: sticky;
          left: 0;
          z-index: 2;
          min-width: 210px;
          padding: 1rem;
          background: #f1e5cf;
          color: #704b15;
          text-align: left;
          white-space: nowrap;
          font-size: 1.05rem;
          font-weight: 800;
        }

        .tally-page .tally-table tbody tr:nth-child(even) td {
          background: #faf6ee;
        }

        .tally-page .tally-table tbody tr:hover td {
          background: #f1e6d1;
        }

        .tally-page .tally-table tbody tr:hover th:first-child {
          background: #e6d3ad;
        }

        .tally-page .tally-table td {
          min-width: 84px;
          padding: 8px;
          text-align: center;
          height: 72px;
        }

        .tally-page .tally-table input {
          transition: background 120ms ease, border-color 120ms ease;
        }

        .tally-page .tally-table input:hover {
          background: #f7eddb !important;
          border-color: #c5a66e !important;
        }

        .tally-page .tally-table input:focus {
          background: white !important;
          border-color: #956b25 !important;
          outline: 2px solid #956b25;
        }

        .tally-page .tally-table input:disabled {
          opacity: 1;
          cursor: default;
        }

        .tally-page .tally-table td:nth-last-child(-n+2) {
          background: #f0e4cc;
        }

        .tally-page .tally-table td:nth-last-child(-n+2) input {
          background: #f8efde;
          border-color: #d8c29b;
          color: #704b15;
          font-size: 1.2rem;
          font-weight: 800;
          text-align: center;
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

        .tally-page .tally-note {
          margin: 0.8rem 0 0;
          color: var(--muted, #776b58);
          font-size: 0.88rem;
          line-height: 1.5;
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
            font-size: 0.95rem;
          }

          .tally-page .tally-table thead th,
          .tally-page .tally-table td {
            min-width: 76px;
          }

          .tally-page .tally-table thead th:first-child,
          .tally-page .tally-table tbody th:first-child {
            min-width: 175px;
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
                  a.code === 'SLI'
                    ? -1
                    : b.code === 'SLI'
                      ? 1
                      : a.code.localeCompare(b.code)
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

        <p className="tally-note">
          {canEdit
            ? 'Enter a daily count and leave the field to save. WTD and MTD update automatically from saved daily counts.'
            : 'Read-only view. Contact an owner or editor to update counts.'}
        </p>
      </div>

      <div className="tally-summary">
        <div className="tally-summary-card">
          <div className="muted">Department WTD</div>
          <div className="tally-summary-number">
            {departmentWTD.toLocaleString()}
          </div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Week-to-Date · all active teams
          </div>
        </div>

        <div className="tally-summary-card">
          <div className="muted">Department MTD</div>
          <div className="tally-summary-number">
            {departmentMTD.toLocaleString()}
          </div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Month-to-Date · all active teams
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
              Daily counts by team · WTD and MTD calculated automatically
            </p>
          </div>

          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {dates.length} days · scroll inside the table
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
                    <th key={date}>{Number(date.slice(8))}</th>
                  ))}
                  <th title="Week-to-Date">WTD</th>
                  <th title="Month-to-Date">MTD</th>
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
                            <span style={{ fontSize: '0.75rem' }}>
                              Saving…
                            </span>
                          )}
                        </td>
                      )
                    })}

                    <td>
                      <strong
                        title="Week-to-Date"
                        style={{
                          display: 'inline-flex',
                          minWidth: '72px',
                          minHeight: '42px',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '10px',
                          background: '#e8d6b3',
                          color: '#674615',
                          fontSize: '1.15rem'
                        }}
                      >
                        {getWTD(team.id).toLocaleString()}
                      </strong>
                    </td>

                    <td>
                      <strong
                        title="Month-to-Date"
                        style={{
                          display: 'inline-flex',
                          minWidth: '72px',
                          minHeight: '42px',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '10px',
                          background: '#dfc797',
                          color: '#503510',
                          fontSize: '1.15rem'
                        }}
                      >
                        {getMTD(team.id).toLocaleString()}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="tally-note">
          WTD means Week-to-Date (Monday through the reporting date). MTD means
          Month-to-Date (the first day of the month through the reporting date).
          Historical months use their final day as the reporting date. Totals are
          calculated per team from daily counts; no separate WID/MID entry is needed.
        </p>
      </div>
    </section>
  )
}
