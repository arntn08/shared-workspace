
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

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthDates = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number)
  const count = new Date(year, monthNumber, 0).getDate()
  return Array.from({ length: count }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    return `${month}-${day}`
  })
}

const cellKey = (teamId: string, date: string) => `${teamId}|${date}`
const totalKey = (teamId: string) => teamId

export default function Tally() {
  const { profile } = useAuth()
  const canEdit =
    profile?.active === true &&
    (profile.role === 'owner' || profile.role === 'editor')

  const [departments, setDepartments] = useState<Department[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [departmentId, setDepartmentId] = useState('')
  const [month, setMonth] = useState(currentMonth)
  const [dailyCounts, setDailyCounts] = useState<Record<string, string>>({})
  const [monthlyTotals, setMonthlyTotals] = useState<
    Record<string, { wid: string; mid: string }>
  >({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const dates = useMemo(() => monthDates(month), [month])
  const monthStart = `${month}-01`

  const activeTeams = useMemo(
    () => teams.filter((team) => team.active && team.department_id === departmentId)
      .sort((a, b) => a.code.localeCompare(b.code)),
    [teams, departmentId]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setMessage('')

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

    if (departmentResult.error || teamResult.error) {
      setError(
        departmentResult.error?.message ||
        teamResult.error?.message ||
        'Could not load departments and teams.'
      )
      setLoading(false)
      return
    }

    const departmentData = (departmentResult.data ?? []) as Department[]
    const teamData = (teamResult.data ?? []) as Team[]

    setDepartments(departmentData)
    setTeams(teamData)

    const chosenDepartment =
      departmentData.find((d) => d.id === departmentId && d.active) ??
      departmentData.find((d) => d.active)

    if (!chosenDepartment) {
      setDailyCounts({})
      setMonthlyTotals({})
      setLoading(false)
      return
    }

    if (chosenDepartment.id !== departmentId) {
      setDepartmentId(chosenDepartment.id)
    }

    const teamIds = teamData
      .filter((t) => t.active && t.department_id === chosenDepartment.id)
      .map((t) => t.id)

    if (teamIds.length === 0) {
      setDailyCounts({})
      setMonthlyTotals({})
      setLoading(false)
      return
    }

    const endDate = dates[dates.length - 1]

    const [dailyResult, totalsResult] = await Promise.all([
      supabase
        .from('installation_daily_counts')
        .select('team_id,work_date,daily_count')
        .in('team_id', teamIds)
        .gte('work_date', monthStart)
        .lte('work_date', endDate),
      supabase
        .from('installation_monthly_totals')
        .select('team_id,month_start,wid,mid')
        .in('team_id', teamIds)
        .eq('month_start', monthStart)
    ])

    if (dailyResult.error || totalsResult.error) {
      setError(
        dailyResult.error?.message ||
        totalsResult.error?.message ||
        'Could not load the monthly board.'
      )
      setLoading(false)
      return
    }

    const nextDaily: Record<string, string> = {}
    for (const row of (dailyResult.data ?? []) as DailyRecord[]) {
      nextDaily[cellKey(row.team_id, row.work_date)] = String(row.daily_count)
    }

    const nextTotals: Record<string, { wid: string; mid: string }> = {}
    for (const row of (totalsResult.data ?? []) as MonthlyRecord[]) {
      nextTotals[totalKey(row.team_id)] = {
        wid: String(row.wid),
        mid: String(row.mid)
      }
    }

    setDailyCounts(nextDaily)
    setMonthlyTotals(nextTotals)
    setLoading(false)
  }, [departmentId, month, monthStart, dates])

  useEffect(() => {
    void load()
  }, [load])

  function updateDailyInput(teamId: string, date: string, value: string) {
    if (value !== '' && (!/^\d+$/.test(value) || Number(value) < 0)) return
    setDailyCounts((current) => ({
      ...current,
      [cellKey(teamId, date)]: value
    }))
  }

  function updateTotalInput(teamId: string, field: 'wid' | 'mid', value: string) {
    if (value !== '' && (!/^\d+$/.test(value) || Number(value) < 0)) return
    setMonthlyTotals((current) => ({
      ...current,
      [teamId]: {
        wid: current[teamId]?.wid ?? '0',
        mid: current[teamId]?.mid ?? '0',
        [field]: value
      }
    }))
  }

  async function saveDaily(teamId: string, date: string) {
    if (!canEdit) return

    const key = cellKey(teamId, date)
    const rawValue = dailyCounts[key] ?? ''
    const value = rawValue === '' ? 0 : Number(rawValue)

    if (!Number.isSafeInteger(value) || value < 0) {
      setError('Daily counts must be whole numbers of zero or more.')
      return
    }

    setSaving(key)
    setError('')
    setMessage('')

    const { error: saveError } = await supabase
      .from('installation_daily_counts')
      .upsert(
        {
          team_id: teamId,
          work_date: date,
          daily_count: value,
          updated_at: new Date().toISOString(),
          updated_by: profile?.id
        },
        { onConflict: 'team_id,work_date' }
      )

    setSaving(null)

    if (saveError) {
      setError(`Could not save ${date}: ${saveError.message}`)
      return
    }

    setDailyCounts((current) => ({ ...current, [key]: String(value) }))
    setMessage(`Saved ${date}.`)
  }

  async function saveMonthly(teamId: string, field: 'wid' | 'mid') {
    if (!canEdit) return

    const key = totalKey(teamId)
    const current = monthlyTotals[key] ?? { wid: '0', mid: '0' }
    const rawValue = current[field]
    const value = rawValue === '' ? 0 : Number(rawValue)

    if (!Number.isSafeInteger(value) || value < 0) {
      setError('WID and MID must be whole numbers of zero or more.')
      return
    }

    const savingKey = `${teamId}|${field}`
    setSaving(savingKey)
    setError('')
    setMessage('')

    const { error: saveError } = await supabase
      .from('installation_monthly_totals')
      .upsert(
        {
          team_id: teamId,
          month_start: monthStart,
          wid: field === 'wid' ? value : Number(current.wid || 0),
          mid: field === 'mid' ? value : Number(current.mid || 0),
          updated_at: new Date().toISOString(),
          updated_by: profile?.id
        },
        { onConflict: 'team_id,month_start' }
      )

    setSaving(null)

    if (saveError) {
      setError(`Could not save ${field.toUpperCase()}: ${saveError.message}`)
      return
    }

    setMonthlyTotals((existing) => ({
      ...existing,
      [key]: { ...current, [field]: String(value) }
    }))
    setMessage(`${field.toUpperCase()} total saved.`)
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
    const csvCell = (value: string | number) =>
      `"${String(value).replace(/"/g, '""')}"`

    const rows = [
      ['Team', ...dates.map((date) => `${Number(date.slice(5))}/${date.slice(2, 4)}`), 'WID', 'MID'],
      ...activeTeams.map((team) => [
        team.code,
        ...dates.map((date) => Number(dailyCounts[cellKey(team.id, date)] || 0)),
        Number(monthlyTotals[team.id]?.wid || 0),
        Number(monthlyTotals[team.id]?.mid || 0)
      ]),
      [
        'Department total',
        ...dates.map((date) =>
          activeTeams.reduce(
            (sum, team) => sum + Number(dailyCounts[cellKey(team.id, date)] || 0),
            0
          )
        ),
        departmentWid,
        departmentMid
      ]
    ]

    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `installation-tally-${month}-${departments.find((d) => d.id === departmentId)?.code ?? 'department'}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
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
        <button className="btn" onClick={exportCsv} disabled={loading || activeTeams.length === 0}>
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
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              {departments.filter((d) => d.active).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.code} — {department.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value)
              }}
            />
          </label>
        </div>

        <div className="muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
          {canEdit
            ? 'Enter a daily count and move out of the cell to save. WID/MID are monthly totals entered separately.'
            : 'Read-only view. Contact an owner or editor to change counts.'}
        </div>
      </div>

      <div className="grid metrics" style={{ marginBottom: '1rem' }}>
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
        <div className="row between" style={{ gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>
            {departments.find((d) => d.id === departmentId)?.code ?? 'Department'} — {month}
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
                      position: 'sticky',
                      left: 0,
                      zIndex: 3,
                      background: 'var(--card, #fff)',
                      minWidth: '150px',
                      textAlign: 'left',
                      padding: '0.65rem',
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
                      {Number(date.slice(5))}/{Number(date.slice(8))}
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
                    <th
                      scope="row"
                      style={{
                        position: 'sticky',
                        left: 0,
                        zIndex: 2,
                        background: 'var(--card, #fff)',
                        textAlign: 'left',
                        padding: '0.5rem 0.65rem',
                        whiteSpace: 'nowrap',
                        borderBottom: '1px solid var(--border)'
                      }}
                    >
                      {team.code}
                    </th>

                    {dates.map((date) => {
                      const key = cellKey(team.id, date)
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
                            onChange={(e) => updateDailyInput(team.id, date, e.target.value)}
                            onBlur={() => void saveDaily(team.id, date)}
                            style={{
                              width: '56px',
                              minWidth: '56px',
                              padding: '0.45rem 0.2rem',
                              textAlign: 'center',
                              border: '1px solid var(--border)',
                              borderRadius: '0.35rem',
                              background: 'var(--input-bg, transparent)',
                              color: 'inherit'
                            }}
                          />
                          {saving === key && (
                            <span aria-label="Saving" style={{ display: 'block', fontSize: '0.65rem' }}>Saving</span>
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
                            aria-label={`${team.code} ${field.toUpperCase()} monthly total`}
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            disabled={!canEdit}
                            value={monthlyTotals[team.id]?.[field] ?? ''}
                            placeholder="0"
                            onChange={(e) => updateTotalInput(team.id, field, e.target.value)}
                            onBlur={() => void saveMonthly(team.id, field)}
                            style={{
                              width: '72px',
                              minWidth: '72px',
                              padding: '0.45rem 0.2rem',
                              textAlign: 'center',
                              border: '1px solid var(--border)',
                              borderRadius: '0.35rem',
                              background: 'var(--input-bg, transparent)',
                              color: 'inherit'
                            }}
                          />
                          {saving === key && (
                            <span aria-label="Saving" style={{ display: 'block', fontSize: '0.65rem' }}>Saving</span>
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
                      position: 'sticky',
                      left: 0,
                      zIndex: 2,
                      background: 'var(--card, #fff)',
                      textAlign: 'left',
                      padding: '0.65rem',
                      borderTop: '2px solid var(--border)'
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
                      {activeTeams.reduce(
                        (sum, team) => sum + Number(dailyCounts[cellKey(team.id, date)] || 0),
                        0
                      ).toLocaleString()}
                    </td>
                  ))}

                  <td style={{ textAlign: 'center', padding: '0.65rem', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    {departmentWid.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'center', padding: '0.65rem', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    {departmentMid.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0, marginTop: '0.75rem' }}>
          Blank daily cells are treated as zero in totals and exports. WID and MID are separately entered monthly totals; they are not automatically calculated from daily counts.
        </p>
      </div>
    </section>
  )
}
