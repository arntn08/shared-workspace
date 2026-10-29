import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type RosterRow = { team?: string | null; code?: string | null; team_code?: string | null }
type TeamRow = { id: string; code: string; name: string; active: boolean; department_id: string }
type DailyRow = { team_id: string; work_date: string; daily_count: number }
type WorkOrderRow = { team_id: string | null; department_id: string | null; status: string; wo_id: string; work_date: string }

const dateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const normalize = (value: string) => value.trim().toUpperCase().replace(/\\s+/g, '')
const stripPrefix = (value: string) => value.replace(/^(AHBA_|A8_|AHBA-|A8-)/, '')

export default function MyTeamSummary() {
  const { profile } = useAuth()
  const [teamRows, setTeamRows] = useState<TeamRow[]>([])
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadSummary() {
      setLoading(true)
      setError('')
      setLoadError('')
      try {
        const { data: rosterData, error: rosterError } = await supabase.rpc('my_roster')
        if (rosterError) throw new Error('Your team assignment could not be loaded. Please contact your workspace owner.')

        const roster = (rosterData ?? []) as RosterRow[]
        const rosterNames = [...new Set(roster.flatMap(row => [row.code, row.team_code, row.team]).map(value => value?.trim()).filter((value): value is string => Boolean(value)))]
        const rosterKeys = new Set(rosterNames.flatMap(name => {
          const key = normalize(name)
          return [key, stripPrefix(key)]
        }))

        const { data: allTeamsData, error: teamsError } = await supabase
          .from('installation_teams')
          .select('id,code,name,active,department_id')
          .eq('active', true)
        if (teamsError) throw teamsError
        const matchedTeams = ((allTeamsData ?? []) as TeamRow[]).filter(team => {
          const code = normalize(team.code)
          const name = normalize(team.name)
          return rosterKeys.has(code) || rosterKeys.has(stripPrefix(code)) || rosterKeys.has(name)
        })
        if (!matchedTeams.length) {
          if (!cancelled) {
            setTeamRows([])
            setDailyRows([])
            setWorkOrders([])
          }
          return
        }

        const now = new Date()
        const today = dateKey(now)
        const monthStart = `${today.slice(0, 7)}-01`
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const dayOfWeek = monday.getDay()
        monday.setDate(monday.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
        const weekStart = dateKey(monday)
        const queryStart = weekStart < monthStart ? weekStart : monthStart
        const teamIds = matchedTeams.map(team => team.id)

        const [dailyResult, ordersResult] = await Promise.all([
          supabase.from('installation_daily_counts')
            .select('team_id,work_date,daily_count')
            .in('team_id', teamIds)
            .gte('work_date', queryStart)
            .lte('work_date', today),
          supabase.from('installation_imported_work_orders')
            .select('team_id,department_id,status,wo_id,work_date')
            .in('team_id', teamIds)
            .gte('work_date', monthStart)
            .lte('work_date', today)
        ])
        if (dailyResult.error) throw dailyResult.error
        if (ordersResult.error) {
          setLoadError(ordersResult.error.code === '42P01' || ordersResult.error.code === 'PGRST205'
            ? 'Total Loads is unavailable because the imported work-orders table is not set up yet.'
            : `Could not load Total Loads: ${ordersResult.error.message}`)
        }
        if (!cancelled) {
          setTeamRows(matchedTeams.sort((a, b) => a.code.localeCompare(b.code)))
          setDailyRows((dailyResult.data ?? []) as DailyRow[])
          setWorkOrders((ordersResult.data ?? []) as WorkOrderRow[])
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your team summary.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSummary()
    return () => { cancelled = true }
  }, [profile?.id])

  const today = dateKey(new Date())
  const monthStart = `${today.slice(0, 7)}-01`
  const weekStart = useMemo(() => {
    const now = new Date()
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const day = monday.getDay()
    monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1))
    return dateKey(monday)
  }, [today])

  const getWTD = (teamId: string) => dailyRows
    .filter(row => row.team_id === teamId && row.work_date >= weekStart && row.work_date <= today)
    .reduce((sum, row) => sum + Number(row.daily_count || 0), 0)
  const getMTD = (teamId: string) => dailyRows
    .filter(row => row.team_id === teamId && row.work_date >= monthStart && row.work_date <= today)
    .reduce((sum, row) => sum + Number(row.daily_count || 0), 0)
  const getStatusCount = (teamId: string, status?: string) => workOrders
    .filter(row => row.team_id === teamId && (!status || String(row.status).toUpperCase() === status))
    .length

  return (
    <section className="page-stack" aria-labelledby="my-team-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">INSTALLATION TALLY</p>
          <h1 id="my-team-heading">My Team Summary</h1>
          <p className="muted">Your assigned team’s WTD, MTD, and imported work-order totals.</p>
        </div>
      </div>

      {error && <div className="notice error" role="alert">{error}</div>}
      {loadError && <div className="notice" role="status">{loadError}</div>}
      {loading ? <article className="card"><p className="muted">Loading your team totals…</p></article> :
        teamRows.length === 0 ? <article className="card"><h2>No team assigned</h2><p className="muted">No active installation team matched your employee roster. Ask the workspace owner to verify your team assignment.</p></article> :
        teamRows.map(team => (
          <article className="card" key={team.id} style={{ padding: '1.1rem', marginBottom: '.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>ASSIGNED TEAM</p>
                <h2 style={{ margin: '.25rem 0 0', overflowWrap: 'anywhere' }}>{team.code}</h2>
                <p className="muted" style={{ margin: '.2rem 0 0' }}>{team.name}</p>
              </div>
              <span className="muted" style={{ fontSize: '.85rem' }}>Reporting date: {today}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '.7rem' }}>
              {([
                ['WTD', getWTD(team.id), 'Monday through reporting date'],
                ['MTD', getMTD(team.id), 'Month start through reporting date'],
                ['Total Loads', getStatusCount(team.id), 'Imported work orders this month'],
                ['Completed', getStatusCount(team.id, 'COMPLETED'), 'Status: completed'],
                ['Incomplete', getStatusCount(team.id, 'INCOMPLETE'), 'Status: incomplete'],
                ['Canceled', getStatusCount(team.id, 'CANCELED'), 'Status: canceled']
              ] as Array<[string, number, string]>).map(([label, value, description]) => (
                <div key={label} style={{ border: '1px solid var(--border, rgba(128,128,128,.2))', borderRadius: 13, padding: '.85rem', background: 'var(--surface, rgba(128,128,128,.04))', minWidth: 0 }}>
                  <div className="muted" style={{ fontSize: '.82rem' }}>{label}</div>
                  <div style={{ fontSize: '1.7rem', fontWeight: 800, lineHeight: 1.25, margin: '.3rem 0', fontVariantNumeric: 'tabular-nums' }}>{value.toLocaleString()}</div>
                  <div className="muted" style={{ fontSize: '.75rem', lineHeight: 1.4 }}>{description}</div>
                </div>
              ))}
            </div>
          </article>
        ))
      }
      <p className="muted" style={{ fontSize: '.82rem' }}>WTD and MTD use the saved daily tally. Total Loads and status counts use imported work orders and are separate from the daily-count board.</p>
    </section>
  )
}
