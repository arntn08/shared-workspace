
import { useCallback, useEffect, useMemo, useState } from 'react'
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

  return Array.from({ length: days }, (_, index) => {
    return `${month}-${String(index + 1).padStart(2, '0')}`
  })
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
    () =>
      teams
        .filter((team) => team.active && team.department_id === departmentId)
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
        departmentRows.find((item) => item.id === departmentId && item.active) ??
        departmentRows.find((item) => item.code === 'SLI' && item.active) ??
        departmentRows.find((item) => item.active)

      if (!selectedDepartment) {
        setDepartmentId('')
        setDailyCounts({})
        setMonthlyTotals({})
        return
      }

      if (selectedDepartment.id !== departmentId) {
        setDepartmentId(selectedDepartment.id)
      }

      const selectedTeamIds = teamRows
        .filter(
          (team) =>
            team.active && team.department_id === selectedDepartment.id
        )
        .map((team) => team.id)

      if (selectedTeamIds.length === 0) {
        setDailyCounts({})
        setMonthlyTotals({})
        return
      }

      const [dailyResult, totalsResult] = await Promise.all([
        supabase
          .from('installation_daily_counts')
          .select('team_id,work_date,daily_count')
          .in('team_id', selectedTeamIds)
          .gte('work_date', monthStart)
          .lte('work_date', monthEnd),
        supabase
          .from('installation_monthly_totals')
          .select('team_id,month_start,wid,mid')
          .in('team_id', selectedTeamIds)
          .eq('month_start', monthStart)
      ])

      if (dailyResult.error) throw dailyResult.error
      if (totalsResult.error) throw totalsResult.error

      const nextDaily: Record<string, string> = {}
      ;((dailyResult.data ?? []) as DailyRecord[]).forEach((row) => {
        nextDaily[dailyKey(row.team_id, row.work_date)] = String(row.daily_count)
      })

      const nextTotals: Record<string, MonthlyTotal> = {}
      ;((totalsResult.data ?? []) as MonthlyRecord[]).forEach((row) => {
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
    if (value !== '' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      return
    }

    setDailyCounts((current) => ({
      ...current,
      [dailyKey(teamId, date)]: value
    }))
  }

  function updateMonthly(teamId: string, field: 'wid' | 'mid', value: string) {
    if (value !== '' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      return
    }

    setMonthlyTotals((current) => ({
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

      setDailyCounts((current) => ({ ...current, [key]: String(count) }))
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
        .upsert(
          {
            team_id: teamId,
            month_start: monthStart,
            wid: field === 'wid' ? count : Number(current.wid || 0),
            mid: field === 'mid' ? count : Number(current.mid || 0),
            updated_at: new Date().toISOString(),
            updated_by: profile?.id
          },
          { onConflict: 'team_id,month_start' }
        )

      if (saveError) throw saveError

      setMonthlyTotals((previous) => ({
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
      ['Team', ...dates.map((date) => Number(date.slice(8))), 'WID', 'MID']
    ]

    activeTeams.forEach((team) => {
      rows.push([
        team.code,
        ...dates.map((date) =>
          Number(dailyCounts[dailyKey(team.id, date)] || 0)
        ),
        Number(monthlyTotals[team.id]?.wid || 0),
        Number(monthlyTotals[team.id]?.mid || 0)
      ])
    })

    rows.push([
      'Department total',
      ...dates.map((date) =>
        activeTeams.reduce(
          (sum, team) =>
            sum + Number(dailyCounts[dailyKey(team.id, date)] || 0),
          0
        )
      ),
      departmentWid,
      departmentMid
    ])

    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `installation-tally-${month}-${
      departments.find((item) => item.id === departmentId)?.code ?? 'department'
    }.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const inputStyle: React.CSSProperties = {
    width: '56px',
    minWidth: '56px',
    padding: '0.45rem 0.2rem',
    textAlign: 'center',
    border: '1px solid var(--border)',
    borderRadius: '0.35rem',
    background: 'var(--input-bg, transparent)',
    color: 'inherit'
  }

  const stickyTeamStyle: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    zIndex: 2,
    background: 'var(--card, #fff)',
    textAlign: 'left',
    padding: '0.5rem 0.65rem',
    whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--border)'
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Installation Tally</h1>
          <p className="muted" style={{ margin: 0 }}>
            Monthly team board · daily counts, WID and MID
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
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.75rem'
          }}
        >
          <label>
            Department
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              {departments
                .filter((department) => department.active)
                .sort((a, b) => {
                  if (a.code === 'SLI') return -1
                  if (b.code === 'SLI') return 1
                  return a.code.localeCompare(b.code)
                })
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code} — {department.name}
                  </option>
                ))}
            </select>
          </label>

          <label>
            Month
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center'
              }}
            >
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
                onChange={(event) => {
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
          </label>
        </div>

        <p className="muted" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
          {canEdit
            ? 'Edit a daily cell, then click outside it to save. WID and MID are entered separately for each month.'
            : 'Read-only view. Contact an owner or editor to update counts.'}
        </p>
      </div>

      <div
        className="grid metrics"
        style={{ marginBottom: '1rem' }}
      >
        <div className="card">
          <div className="muted">Department WID</div>
          <div className="metric-value">{departmentWid.toLocaleString()}</div>
        </div>

        <div className="card">
          <div className="muted">Department MID</div>
          <div className="metric-value">{departmentMid.toLocaleString()}</div>
        </div>

        <div className="card">
          <div className="muted">Active teams</div>
          <div className="metric-value">{activeTeams.length}</div>
        </div>
      </div>

      <div className="card">
        <div
          className="row between"
          style={{
            gap: '0.75rem',
            flexWrap: 'wrap',
            marginBottom: '0.75rem'
          }}
        >
          <h2 style={{ margin: 0 }}>
            {departments.find((item) => item.id === departmentId)?.code ??
              'Department'}{' '}
            — {month}
          </h2>

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
          <div
            style={{
              overflowX: 'auto',
              maxWidth: '100%',
              border: '1px solid var(--border)',
              borderRadius: '0.65rem'
            }}
          >
            <table
              style={{
                borderCollapse: 'separate',
                borderSpacing: 0,
                width: 'max-content',
                minWidth: '100%',
                fontSize: '0.85rem'
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      ...stickyTeamStyle,
                      zIndex: 3,
                      minWidth: '150px',
                      borderBottom: '2px solid var(--border)'
                    }}
                  >
                    Team
                  </th>

                  {dates.map((date) => (
                    <th
                      key={date}
                      style={{
                        minWidth: '64px',
                        textAlign: 'center',
                        padding: '0.65rem 0.35rem',
                        whiteSpace: 'nowrap',
                        background: 'var(--card, #fff)',
                        borderBottom: '2px solid var(--border)'
                      }}
                    >
                      {Number(date.slice(8))}
                    </th>
                  ))}

                  {(['wid', 'mid'] as const).map((field) => (
                    <th
                      key={field}
                      style={{
                        minWidth: '82px',
                        textAlign: 'center',
                        padding: '0.65rem',
                        background: 'var(--card, #fff)',
                        borderBottom: '2px solid var(--border)'
                      }}
                    >
                      {field.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {activeTeams.map((team) => (
                  <tr key={team.id}>
                    <th scope="row" style={stickyTeamStyle}>
                      {team.code}
                    </th>

                    {dates.map((date) => {
                      const key = dailyKey(team.id, date)

                      return (
                        <td
                          key={date}
                          style={{
                            padding: '0.2rem',
                            textAlign: 'center',
                            borderBottom: '1px solid var(--border)'
                          }}
                        >
                          <input
                            aria-label={`${team.code} count for ${date}`}
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            disabled={!canEdit}
                            value={dailyCounts[key] ?? ''}
                            placeholder="0"
                            onChange={(event) =>
                              updateDaily(team.id, date, event.target.value)
                            }
                            onBlur={() => void saveDaily(team.id, date)}
                            style={inputStyle}
                          />

                          {saving === key && (
                            <span
                              style={{ display: 'block', fontSize: '0.65rem' }}
                            >
                              Saving…
                            </span>
                          )}
                        </td>
                      )
                    })}

                    {(['wid', 'mid'] as const).map((field) => {
                      const key = `${team.id}|${field}`

                      return (
                        <td
                          key={field}
                          style={{
                            padding: '0.2rem',
                            textAlign: 'center',
                            borderBottom: '1px solid var(--border)'
                          }}
                        >
                          <input
                            aria-label={`${team.code} ${field.toUpperCase()} total`}
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            disabled={!canEdit}
                            value={monthlyTotals[team.id]?.[field] ?? ''}
                            placeholder="0"
                            onChange={(event) =>
                              updateMonthly(team.id, field, event.target.value)
                            }
                            onBlur={() => void saveMonthly(team.id, field)}
                            style={{ ...inputStyle, width: '72px', minWidth: '72px' }}
                          />

                          {saving === key && (
                            <span
                              style={{ display: 'block', fontSize: '0.65rem' }}
                            >
                              Saving…
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}

                <tr>
                  <th
                    scope="row"
                    style={{
                      ...stickyTeamStyle,
                      borderTop: '2px solid var(--border)',
                      fontWeight: 700
                    }}
                  >
                    Department total
                  </th>

                  {dates.map((date) => (
                    <td
                      key={date}
                      style={{
                        textAlign: 'center',
                        padding: '0.65rem 0.35rem',
                        fontWeight: 700,
                        borderTop: '2px solid var(--border)'
                      }}
                    >
                      {activeTeams
                        .reduce(
                          (sum, team) =>
                            sum +
                            Number(dailyCounts[dailyKey(team.id, date)] || 0),
                          0
                        )
                        .toLocaleString()}
                    </td>
                  ))}

                  <td
                    style={{
                      textAlign: 'center',
                      padding: '0.65rem',
                      fontWeight: 700,
                      borderTop: '2px solid var(--border)'
                    }}
                  >
                    {departmentWid.toLocaleString()}
                  </td>

                  <td
                    style={{
                      textAlign: 'center',
                      padding: '0.65rem',
                      fontWeight: 700,
                      borderTop: '2px solid var(--border)'
                    }}
                  >
                    {departmentMid.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p
          className="muted"
          style={{ fontSize: '0.8rem', marginBottom: 0, marginTop: '0.75rem' }}
        >
          Blank daily cells count as zero in totals and exports. WID and MID are
          separately entered monthly totals.
        </p>
      </div>
    </section>
  )
}
