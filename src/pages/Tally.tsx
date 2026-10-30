
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import * as XLSX from 'xlsx'

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

type RosterRow = { team?: string | null; code?: string | null; team_code?: string | null; jo_mob?: string | null }

type DailyRecord = {
  team_id: string
  work_date: string
  daily_count: number
}

type ImportPreviewRow = {
  date: string
  teamCode: string
  teamName: string
  teamId: string
  count: number
}

type ImportPreview = {
  // Individual rows are retained for status breakdown and duplicate protection.
  fileName: string
  rows: ImportPreviewRow[]
  completedRows: number
  ignoredRows: number
  duplicateRows: number
  unmatched: Array<{ teamCode: string; count: number }>
  workOrders: Array<{ wo_id: string; work_date: string; team_id: string; department_id: string; team_assigned_raw: string; status: 'COMPLETED' | 'INCOMPLETE' | 'CANCELED' | 'OTHER'; team_remarks: string; source_file: string; raw_row: Record<string, unknown> }>
}

const getCurrentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const addDays = (dateString: string, amount: number) => {
  const date = new Date(`${dateString}T12:00:00`)
  date.setDate(date.getDate() + amount)
  return formatDate(date)
}

const getWeekDates = (start: string) =>
  Array.from({ length: 7 }, (_, index) => addDays(start, index))

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
  const [myTeamCodes, setMyTeamCodes] = useState<string[]>([])
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({})
  const [teams, setTeams] = useState<Team[]>([])
  const [departmentId, setDepartmentId] = useState('')
  const [month, setMonth] = useState(getCurrentMonth)
  const [weekOffset, setWeekOffset] = useState(0)
  const [dailyCounts, setDailyCounts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importing, setImporting] = useState(false)
  const [importedLoads, setImportedLoads] = useState<Array<{work_date:string; team_id:string|null; department_id:string|null; status:string; wo_id:string}>>([])
  const [loadBreakdownError, setLoadBreakdownError] = useState('')
  const [tallyView, setTallyView] = useState<'wtd-mtd' | 'total-loads'>('wtd-mtd')

  useEffect(() => {
    if (canEdit || !profile?.id) return
    let cancelled = false
    supabase.rpc('my_roster').then(({ data, error }) => {
      if (cancelled || error) return
      const rows = (data ?? []) as RosterRow[]
      setMyTeamCodes([...new Set(rows.flatMap(row => [row.code, row.team_code, row.team]).map(value => value?.trim()).filter((code): code is string => Boolean(code)))])
    })
    return () => { cancelled = true }
  }, [canEdit, profile?.id])

  const monthDates = useMemo(() => getMonthDates(month), [month])
  const monthStart = `${month}-01`
  const monthEnd = monthDates[monthDates.length - 1]
  const currentWeekStart = getWeekStart(formatDate(new Date()))
  const weekStart = addDays(currentWeekStart, weekOffset * 7)
  const dates = useMemo(() => getWeekDates(weekStart), [weekStart])
  const weekEnd = dates[dates.length - 1]
  const nowDate = formatDate(new Date())
  const reportDate = weekStart > nowDate ? weekStart : weekEnd < nowDate ? weekEnd : nowDate

  const activeTeams = useMemo(
    () =>
      teams
        .filter(team => team.active && team.department_id === departmentId)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [teams, departmentId, canEdit, myTeamCodes]
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
      const monthQueryStart = formatDate(firstOfMonth)
      const queryStart = monthQueryStart < weekStart ? monthQueryStart : weekStart
      const queryEnd = monthEnd > weekEnd ? monthEnd : weekEnd

      const dailyResult = await supabase
        .from('installation_daily_counts')
        .select('team_id,work_date,daily_count')
        .in('team_id', teamIds)
        .gte('work_date', queryStart)
        .lte('work_date', queryEnd)

      if (dailyResult.error) throw dailyResult.error

      const nextDaily: Record<string, string> = {}

      ;((dailyResult.data ?? []) as DailyRecord[]).forEach(row => {
        nextDaily[dailyKey(row.team_id, row.work_date)] =
          String(row.daily_count)
      })

      setDailyCounts(nextDaily)
      const loadResult = await supabase
        .from('installation_imported_work_orders')
        .select('work_date,team_id,department_id,status,wo_id')
        .gte('work_date', monthStart)
        .lte('work_date', monthEnd)
      if (loadResult.error) {
        setImportedLoads([])
        setLoadBreakdownError(
          loadResult.error.code === '42P01' || loadResult.error.code === 'PGRST205'
            ? 'The imported-work-orders table is not available yet. Run the supplied Supabase SQL, then refresh.'
            : `Could not load imported status totals: ${loadResult.error.message}`
        )
      } else {
        setImportedLoads((loadResult.data ?? []) as Array<{work_date:string; team_id:string|null; department_id:string|null; status:string; wo_id:string}>)
        setLoadBreakdownError('')
      }

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load the tally board.'
      )
    } finally {
      setLoading(false)
    }
  }, [departmentId, month, monthEnd, monthStart, weekStart, weekEnd])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  // Keep shared completed totals fresh for every signed-in account.
  useEffect(() => {
    const refreshImportedLoads = async () => {
      const [year, monthNumber] = month.split('-').map(Number)
      const start = `${month}-01`
      const end = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`
      const result = await supabase
        .from('installation_imported_work_orders')
        .select('work_date,team_id,department_id,status,wo_id')
        .gte('work_date', start)
        .lte('work_date', end)
      if (!result.error) {
        setImportedLoads((result.data ?? []) as Array<{work_date:string; team_id:string|null; department_id:string|null; status:string; wo_id:string}>)
        setLoadBreakdownError('')
      }
    }
    const timer = window.setInterval(() => { void refreshImportedLoads() }, 30000)
    return () => window.clearInterval(timer)
  }, [month])

  function changeWeek(offset: number) {
    const nextWeekStart = addDays(weekStart, offset * 7)
    setWeekOffset(current => current + offset)
    setMonth(nextWeekStart.slice(0, 7))
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


  function normalizeHeader(value: unknown) {
    return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  }

  function parseExcelDate(value: unknown): string | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return formatDate(value)
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const parsed = XLSX.SSF.parse_date_code(value)
      if (parsed) {
        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
      }
    }

    const raw = String(value ?? '').trim()
    if (!raw) return null
    const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`

    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return formatDate(parsed)
    return null
  }

  async function previewExcel(file: File | undefined) {
    setError('')
    setMessage('')
    setImportPreview(null)
    if (!file) return
    if (!canEdit) {
      setError('Only owners and editors can import completed installations.')
      return
    }

    try {
      const bytes = await file.arrayBuffer()
      const workbook = XLSX.read(bytes, { type: 'array', cellDates: true })
      const sheetName = workbook.SheetNames.find(name => /load history/i.test(name)) ?? workbook.SheetNames[0]
      if (!sheetName) throw new Error('The Excel workbook has no worksheets.')
      const sheet = workbook.Sheets[sheetName]
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
      if (!records.length) throw new Error('The selected worksheet contains no data rows.')

      const headers = Object.keys(records[0]).map(normalizeHeader)
      const required = ['DATE', 'STATUS', 'TEAM ASSIGNED', 'WO ID']
      const missing = required.filter(header => !headers.includes(header))
      if (missing.length) throw new Error(`Missing required Excel column(s): ${missing.join(', ')}.`)

      const normalizeTeamCode = (value: unknown) =>
        String(value ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-')
      const teamByCode = new Map<string, Team>()
      const teamAliases = new Map<string, Team[]>()
      const addAlias = (alias: string, team: Team) => {
        if (!alias) return
        const current = teamAliases.get(alias) ?? []
        if (!current.some(item => item.id === team.id)) current.push(team)
        teamAliases.set(alias, current)
      }
      teams.filter(team => team.active).forEach(team => {
        const code = normalizeTeamCode(team.code)
        teamByCode.set(code, team)
        addAlias(code, team)
        // Excel exports may use three-digit OMT codes while Supabase stores
        // the matching two-digit codes. Map each code to its own team.
        const omtCodeAliases: Record<string, string> = {
          AHBA_OMT001: 'AHBA_OMT01',
          AHBA_OMT002: 'AHBA_OMT02',
          AHBA_OMT003: 'AHBA_OMT03'
        }
        const aliasTarget = omtCodeAliases[code]
        if (aliasTarget) {
          const matchingTeam = teams.find(
            item => item.active && normalizeTeamCode(item.code) === aliasTarget
          )
          if (matchingTeam) addAlias(code, matchingTeam)
        }
        // Excel exports sometimes include a company prefix that isn't part of the configured team code.
        const stripped = code.replace(/^(AHBA_|A8_|AHBA-|A8-)/, '')
        if (stripped !== code) addAlias(stripped, team)
        addAlias(code.replace(/^(AHBA_|A8_|AHBA-|A8-)/, ''), team)
      })
      const grouped = new Map<string, ImportPreviewRow>()
      const workOrders: ImportPreview['workOrders'] = []
      const seenWorkOrders = new Set<string>()
      const unmatchedCounts = new Map<string, number>()
      let completedRows = 0
      let ignoredRows = 0
      let duplicateRows = 0

      for (const record of records) {
        const normalized: Record<string, unknown> = {}
        Object.entries(record).forEach(([key, value]) => {
          normalized[normalizeHeader(key)] = value
        })

        const status = String(normalized.STATUS ?? '').trim().toUpperCase()
        const isCompleted = status === 'COMPLETED'
        if (isCompleted) completedRows += 1
        else ignoredRows += 1

        const workOrder = String(normalized['WO ID'] ?? '').trim().toUpperCase()
        const date = parseExcelDate(normalized.DATE)
        const teamCode = String(normalized['TEAM ASSIGNED'] ?? '').trim().toUpperCase()

        if (workOrder && seenWorkOrders.has(workOrder)) {
          duplicateRows += 1
          continue
        }
        if (workOrder) seenWorkOrders.add(workOrder)

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          ignoredRows += 1
          continue
        }
        const normalizedTeamCode = normalizeTeamCode(teamCode)
        let team = teamByCode.get(normalizedTeamCode)
        if (!team) {
          const strippedCode = normalizedTeamCode.replace(/^(AHBA_|A8_|AHBA-|A8-)/, '')
          const candidates = teamAliases.get(strippedCode) ?? []
          if (candidates.length === 1) team = candidates[0]
        }
        if (!team) {
          unmatchedCounts.set(teamCode || '(blank team)', (unmatchedCounts.get(teamCode || '(blank team)') ?? 0) + 1)
          continue
        }

        const key = `${team.id}|${date}`
        if (!isCompleted) {
          if (workOrder) workOrders.push({ wo_id: workOrder, work_date: date, team_id: team.id, department_id: team.department_id, team_assigned_raw: teamCode, status: status.includes('CANCEL') ? 'CANCELED' : status.includes('INCOMPLETE') || status.includes('IN COMPLE') ? 'INCOMPLETE' : 'OTHER', team_remarks: String(normalized['TEAM REMARKS'] ?? ''), source_file: file.name, raw_row: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])) })
          continue
        }
        const normalizedStatus = status.includes('CANCEL')
          ? 'CANCELED'
          : status.includes('INCOMPLETE') || status.includes('IN COMPLE')
            ? 'INCOMPLETE'
            : status === 'COMPLETED'
              ? 'COMPLETED'
              : 'OTHER'
        if (workOrder) {
          workOrders.push({
            wo_id: workOrder,
            work_date: date,
            team_id: team.id,
            department_id: team.department_id,
            team_assigned_raw: teamCode,
            status: normalizedStatus,
            team_remarks: String(normalized['TEAM REMARKS'] ?? ''),
            source_file: file.name,
            raw_row: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]))
          })
        }

        const existing = grouped.get(key)
        if (existing) existing.count += 1
        else grouped.set(key, { date, teamCode: team.code, teamName: team.name, teamId: team.id, count: 1 })
      }

      const rows = [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date) || a.teamCode.localeCompare(b.teamCode))
      if (!rows.length) {
        const sampleCodes = [...unmatchedCounts.entries()].slice(0, 8).map(([code, count]) => `${code} (${count})`).join(', ')
        throw new Error(
          completedRows === 0
            ? 'No rows have STATUS = COMPLETED. Check that the Excel status column contains COMPLETED.'
            : `Found ${completedRows} completed rows, but none matched a configured active team and valid date. Unmatched team codes: ${sampleCodes || 'none'}.`
        )
      }
      setImportPreview({
        fileName: file.name,
        rows,
        completedRows,
        ignoredRows,
        duplicateRows,
        unmatched: [...unmatchedCounts.entries()].map(([teamCode, count]) => ({ teamCode, count })),
        workOrders
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this Excel file.')
    }
  }

  async function importCompletedCounts() {
    if (!canEdit || !importPreview || importing) return
    setImporting(true)
    setError('')
    setMessage('')
    try {
      if (importPreview.workOrders.length) {
        const { error: recordsError } = await supabase
          .from('installation_imported_work_orders')
          .upsert(importPreview.workOrders.map(row => ({
            ...row,
            imported_by: profile?.id ?? null
          })), { onConflict: 'wo_id', ignoreDuplicates: true })
        if (recordsError) throw recordsError
      }

      const payload = importPreview.rows.map(row => ({
        team_id: row.teamId,
        work_date: row.date,
        daily_count: row.count,
        updated_at: new Date().toISOString(),
        updated_by: profile?.id
      }))
      const { error: importError } = await supabase
        .from('installation_daily_counts')
        .upsert(payload, { onConflict: 'team_id,work_date' })
      if (importError) throw importError

      setMessage(`Processed ${importPreview.workOrders.length.toLocaleString()} work-order rows and updated completed tally groups. Existing WO IDs are skipped; status totals refreshed.`)
      setImportPreview(null)
      await loadBoard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import completed installations.')
    } finally {
      setImporting(false)
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
    return monthDates
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

  const completedInstalled = importedLoads.filter(row => row.status === 'COMPLETED').length
  const daysRemaining = month === getCurrentMonth()
    ? Math.max(0, Number(monthEnd.slice(-2)) - Number(nowDate.slice(-2)))
    : month > getCurrentMonth() ? Number(monthEnd.slice(-2)) : 0

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
      ['Team', ...dates, 'WTD', 'MTD']
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

        .tally-page .tally-control-layout {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 1rem;
          align-items: end;
        }
        .tally-page .tally-view-tabs {
          display: flex;
          gap: .5rem;
          flex-wrap: wrap;
        }
        .tally-page .tally-toolbar {
          display: grid;
          grid-template-columns: minmax(180px, 1fr) minmax(240px, 1fr);
          gap: .75rem;
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
          background: var(--tally-soft);
          color: var(--text, #30291e);
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
          background: var(--tally-card);
          color: var(--text, #30291e);
        }

        .tally-page .tally-table thead th:nth-last-child(-n+2) {
          min-width: 120px;
          background: var(--tally-accent);
          color: white;
        }

        .tally-page .tally-table tbody th:first-child {
          position: sticky;
          left: 0;
          z-index: 2;
          min-width: 210px;
          padding: 1rem;
          background: var(--tally-soft);
          color: var(--text, #30291e);
          text-align: left;
          white-space: nowrap;
          font-size: 1.05rem;
          font-weight: 800;
        }

        .tally-page .tally-table tbody tr:nth-child(even) td {
          background: var(--tally-card);
        }

        .tally-page .tally-table tbody tr:hover td {
          background: var(--tally-soft);
        }

        .tally-page .tally-table tbody tr:hover th:first-child {
          background: var(--tally-soft);
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
          background: color-mix(in srgb, var(--tally-accent) 9%, var(--tally-card));
        }

        .tally-page .tally-table td:nth-last-child(-n+2) input {
          background: var(--tally-soft);
          border-color: var(--tally-border);
          color: var(--text, #30291e);
          font-size: 1.2rem;
          font-weight: 800;
          text-align: center;
        }

        .tally-page .tally-summary {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
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

        .tally-page .tally-live-summary {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: .75rem;
          margin-bottom: .75rem;
        }
        .tally-page .page-head { margin-bottom: .75rem; }
        .tally-page .tally-live-summary .tally-summary-card {
          padding: .75rem 1rem;
          border-radius: 14px;
        }
        .tally-page .tally-live-summary .tally-summary-number {
          margin-top: .15rem;
          font-size: clamp(1.35rem, 2vw, 1.7rem);
        }
        .tally-page .tally-live-summary small { font-size: .75rem; }
        .tally-page > .card { padding: .85rem 1rem; }
        .tally-page .tally-toolbar { gap: .75rem; }
        .tally-page .tally-note { margin: .45rem 0 0; }
        .tally-page .tally-table thead th { height: 44px; padding: .65rem .6rem; }
        .tally-page .tally-table td { height: 54px; padding: 5px; }
        .tally-page .tally-table tbody th:first-child { padding: .65rem .8rem; }
        .tally-page .tally-scroll { max-height: min(72vh, 680px); }
        .tally-page .tally-live-card {
          position: relative;
          overflow: hidden;
          border-radius: 18px;
          background: linear-gradient(135deg, var(--tally-card), var(--tally-soft));
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.045);
        }
        .tally-page .tally-live-card::after {
          content: '';
          position: absolute;
          width: 100px;
          height: 100px;
          right: -28px;
          top: -30px;
          border-radius: 50%;
          background: color-mix(in srgb, var(--tally-accent) 10%, transparent);
          pointer-events: none;
        }
        .tally-page .tally-live-card small { display: block; margin-top: .35rem; }
        .tally-page .tally-summary-number {
          margin-top: 0.35rem;
          font-size: 1.8rem;
          font-weight: 750;
          line-height: 1.2;
          color: var(--tally-accent);
          font-variant-numeric: tabular-nums;
        }


        .tally-page .tally-mobile-teams { display: none; }
        .tally-page .tally-mobile-team { border: 1px solid var(--tally-border); border-radius: 16px; background: var(--tally-card); margin: 0 0 .75rem; overflow: hidden; }
        .tally-page .tally-mobile-team summary { list-style: none; cursor: pointer; padding: 1rem; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: .75rem; align-items: center; }
        .tally-page .tally-mobile-team summary::-webkit-details-marker { display:none; }
        .tally-page .tally-mobile-team-name { font-weight: 800; overflow-wrap: anywhere; }
        .tally-page .tally-mobile-totals { display:flex; gap:.5rem; }
        .tally-page .tally-mobile-total { min-width: 58px; text-align:center; border-radius:10px; background:var(--tally-soft); padding:.45rem .55rem; }
        .tally-page .tally-mobile-total strong { display:block; color:var(--tally-accent); font-size:1.1rem; }
        .tally-page .tally-mobile-total small { font-size:.68rem; }
        .tally-page .tally-mobile-days { padding: 0 .75rem .85rem; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.5rem; }
        .tally-page .tally-mobile-day { display:flex; justify-content:space-between; align-items:center; gap:.5rem; border-radius:10px; background:var(--tally-soft); padding:.6rem .7rem; }
        .tally-page .tally-mobile-day input { width:64px; max-width:42%; min-height:40px; text-align:center; border:1px solid var(--tally-border); border-radius:9px; background:var(--tally-card); color:var(--text); font-size:1rem; }
        @media (max-width: 600px) {
          .tally-page .tally-mobile-teams { display:block; }
          .tally-page .tally-desktop-table { display:none; }
          .tally-page .tally-month-title { align-items:flex-start; }
          .tally-page .tally-month-title > span { display:none; }
          .tally-page .tally-mobile-totals { gap:.35rem; }
          .tally-page .tally-mobile-total { min-width:50px; padding:.4rem; }
          .tally-page .tally-mobile-team summary { padding:.85rem; }
          .tally-page .tally-mobile-days { grid-template-columns:1fr 1fr; }
          .tally-page .tally-toolbar { grid-template-columns:1fr; }
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
          .tally-page .tally-control-layout {
            grid-template-columns: 1fr;
            gap: .75rem;
          }
          .tally-page .tally-toolbar {
            grid-template-columns: 1fr 1fr;
          }

          .tally-page .tally-summary,
          .tally-page .tally-live-summary {
            grid-template-columns: 1fr 1fr;
            gap: .5rem;
          }

          .tally-page .tally-live-summary .tally-summary-card { padding: .7rem; }
          .tally-page .tally-live-summary .tally-summary-number { font-size: 1.35rem; }

          .tally-page .tally-summary-card:last-child {
            grid-column: 1 / -1;
          }

          .tally-page .tally-scroll {
            max-height: min(68vh, 560px);
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
            Weekly installation performance by team
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {canEdit && (
            <label className="btn" style={{ cursor: importing ? 'wait' : 'pointer' }}>
              {importing ? 'Importing…' : 'Import Excel'}
              <input
                type="file"
                accept=".xlsx,.xls"
                disabled={importing || loading}
                onChange={event => {
                  void previewExcel(event.target.files?.[0])
                  event.currentTarget.value = ''
                }}
                style={{ display: 'none' }}
              />
            </label>
          )}
          {canEdit && <button
            type="button"
            className="btn"
            onClick={exportCsv}
            disabled={loading || activeTeams.length === 0}
          >
            Export CSV
          </button>}
        </div>
      </div>

      <section className="card" style={{marginBottom:'1rem',padding:'1rem'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:'.75rem',alignItems:'center',flexWrap:'wrap'}}>
          <div><h2 style={{margin:0,fontSize:'1.05rem'}}>Monthly team quota</h2><p className="muted" style={{margin:'.2rem 0 0'}}>Target: 50 installations per team · {month}</p></div>
          <strong>{activeTeams.filter(team=>getMTD(team.id)>=50).length} / {activeTeams.length} teams at quota</strong>
        </div>
        <div style={{overflowX:'auto',marginTop:'.8rem'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.9rem'}}>
            <thead><tr><th style={{textAlign:'left',padding:'.55rem'}}>Team</th><th style={{textAlign:'right',padding:'.55rem'}}>Team Total</th><th style={{textAlign:'right',padding:'.55rem'}}>Shortfall</th><th style={{textAlign:'left',padding:'.55rem'}}>Status</th></tr></thead>
            <tbody>{activeTeams.map(team=>{const total=getMTD(team.id);const shortfall=Math.max(0,50-total);const critical=total<=20;const nte=total<=30;const below=total<50;return <tr key={team.id} style={{background:critical?'rgba(220,38,38,.16)':nte?'rgba(220,38,38,.10)':below?'rgba(217,119,6,.08)':'rgba(22,163,74,.07)',borderTop:'1px solid var(--border)'}}>
              <th scope="row" style={{textAlign:'left',padding:'.65rem',fontWeight:800}}>{team.code} · {team.name}</th>
              <td style={{textAlign:'right',padding:'.65rem',fontWeight:900,fontVariantNumeric:'tabular-nums'}}>{total}</td>
              <td style={{textAlign:'right',padding:'.65rem',fontVariantNumeric:'tabular-nums'}}>{shortfall}</td>
              <td style={{padding:'.65rem',fontWeight:800,color:critical?'#dc2626':nte?'#dc2626':below?'#b7791f':'#16834a'}}>{critical?'NTE + Disciplinary Action':nte?'Subject for NTE':below?'Below quota':'Quota'}</td>
            </tr>})}</tbody>
          </table>
        </div>
        <p className="muted" style={{fontSize:'.76rem',margin:'.65rem 0 0'}}>Red: 30 or fewer installations (shortfall 20+). 20 or fewer (shortfall 30+) receives the higher-priority NTE and disciplinary-action indicator. This is a monitoring flag, not an automatic sanction.</p>
      </section>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <div className="tally-summary tally-live-summary" aria-live="polite">
        <div className="tally-summary-card tally-live-card">
          <span className="muted">Completed installed · {month}</span>
          <div className="tally-summary-number">{completedInstalled.toLocaleString()}</div>
          <small className="muted">Unique imported work orders marked COMPLETED</small>
        </div>
        <div className="tally-summary-card tally-live-card">
          <span className="muted">Days remaining in month</span>
          <div className="tally-summary-number">{daysRemaining}</div>
          <small className="muted">{month === getCurrentMonth() ? 'Until month-end' : 'Based on selected month'}</small>
        </div>
      </div>

      {importPreview && (
        <div className="card" style={{ marginBottom: '1rem', border: '1px solid var(--tally-border)' }}>
          <div className="tally-month-title">
            <div>
              <h2 style={{ margin: 0 }}>Import preview</h2>
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>{importPreview.fileName}</p>
            </div>
            <button type="button" className="btn" onClick={() => setImportPreview(null)} disabled={importing}>Cancel</button>
          </div>
          <div className="tally-summary">
            <div className="tally-summary-card">
              <div className="muted">Completed rows</div>
              <div className="tally-summary-number">{importPreview.completedRows.toLocaleString()}</div>
            </div>
            <div className="tally-summary-card">
              <div className="muted">Counts to import</div>
              <div className="tally-summary-number">{importPreview.rows.reduce((sum, row) => sum + row.count, 0).toLocaleString()}</div>
            </div>
            <div className="tally-summary-card">
              <div className="muted">Duplicate WO IDs</div>
              <div className="tally-summary-number">{importPreview.duplicateRows.toLocaleString()}</div>
            </div>
          </div>
          <div className="tally-summary" style={{ marginTop: '0.75rem' }}>
            <div className="tally-summary-card">
              <div className="muted">What this means</div>
              <p style={{ margin: '0.45rem 0 0', lineHeight: 1.5 }}>
                Each Excel row with <strong>STATUS = COMPLETED</strong> counts as one completed load. The WO ID is used to skip repeated work orders within this file. Rows are grouped by installation date and matched team.
              </p>
            </div>
            <div className="tally-summary-card">
              <div className="muted">Excluded from completed total</div>
              <p style={{ margin: '0.45rem 0 0', lineHeight: 1.5 }}>
                Incomplete, canceled, and other statuses are not included in this completed-only import. Unmatched team codes and invalid dates are excluded and shown below when detected.
              </p>
            </div>
          </div>
          <p className="tally-note">
            Only rows whose STATUS is exactly COMPLETED are counted. All other statuses are ignored.
            Import replaces the saved daily count for each team/date listed below; team/date pairs not in this file stay unchanged.
          </p>
          {importPreview.unmatched.length > 0 && (
            <div className="notice error" style={{ marginBottom: '1rem' }}>
              Some completed rows were not matched to a configured team and will not be imported:
              <ul>{importPreview.unmatched.map(item => <li key={item.teamCode}>{item.teamCode}: {item.count}</li>)}</ul>
            </div>
          )}
          <div className="tally-scroll" style={{ maxHeight: '320px' }}>
            <table className="tally-table">
              <thead><tr><th>Installation date</th><th>Team code</th><th>Team name</th><th>Completed count</th></tr></thead>
              <tbody>
                {importPreview.rows.map(row => (
                  <tr key={`${row.teamId}|${row.date}`}>
                    <td>{row.date}</td><td>{row.teamCode}</td><td>{row.teamName}</td><td><strong>{row.count}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', gap: '0.5rem' }}>
            <button type="button" className="btn" onClick={() => setImportPreview(null)} disabled={importing}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void importCompletedCounts()} disabled={importing || importPreview.rows.length === 0}>
              {importing ? 'Importing…' : 'Confirm import'}
            </button>
          </div>
        </div>
      )}

      <div className="card tally-control-panel" style={{ marginBottom: '1rem' }}>
        <div className="tally-control-layout">
          <div role="tablist" aria-label="Installation tally views" className="tally-view-tabs">
            <button
              type="button"
              role="tab"
              aria-selected={tallyView === 'wtd-mtd'}
              className={tallyView === 'wtd-mtd' ? 'btn primary' : 'btn'}
              onClick={() => setTallyView('wtd-mtd')}
            >
              WTD / MTD
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tallyView === 'total-loads'}
              className={tallyView === 'total-loads' ? 'btn primary' : 'btn'}
              onClick={() => setTallyView('total-loads')}
            >
              Total Loads
            </button>
          </div>

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
                Reporting week
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button type="button" className="btn" aria-label="Previous week" onClick={() => changeWeek(-1)}>←</button>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'center', fontWeight: 700 }}>
                  {new Date(`${weekStart}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' — '}
                  {new Date(`${weekEnd}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <button type="button" className="btn" aria-label="Next week" onClick={() => changeWeek(1)}>→</button>
              </div>
            </div>
          </div>
        </div>
        {tallyView === 'wtd-mtd' && (
          <p className="tally-note">
            {canEdit
              ? 'Enter a daily count and leave the field to save. Weekly dates are shown; WTD and MTD update automatically from saved daily counts.'
              : 'Read-only view. Contact an owner or editor to update counts.'}
          </p>
        )}
      </div>

      {tallyView === 'total-loads' && (
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="tally-month-title">
          <div>
            <h2 style={{ margin: 0 }}>Imported load status</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>Excel work orders by status · {month}</p>
          </div>
          <span className="muted" style={{ fontSize: '0.85rem' }}>Duplicates excluded by WO ID</span>
        </div>
        {loadBreakdownError && <div className="notice error">{loadBreakdownError}</div>}
        <div className="tally-summary" style={{ marginBottom: '1rem' }}>
          {([
            ['Total load', ['COMPLETED','INCOMPLETE','CANCELED','OTHER']],
            ['Completed', ['COMPLETED']],
            ['Incomplete', ['INCOMPLETE']],
            ['Canceled', ['CANCELED']]
          ] as Array<[string,string[]]>).map(([label,statuses]) => {
            const count = importedLoads.filter(row =>
              row.department_id === departmentId && statuses.includes(String(row.status).toUpperCase())
            ).length
            return <div className="tally-summary-card" key={label}>
              <div className="muted">{label}</div>
              <div className="tally-summary-number">{count.toLocaleString()}</div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>Selected department · this month</div>
            </div>
          })}
        </div>
        {canEdit && <div className="tally-scroll" style={{ maxHeight: '320px' }}>
          <table className="tally-table">
            <thead><tr><th>Team</th><th>Total load</th><th>Completed</th><th>Incomplete</th><th>Canceled</th></tr></thead>
            <tbody>
              {activeTeams.map(team => {
                const rows = importedLoads.filter(row => row.team_id === team.id)
                const countStatus = (status: string) => rows.filter(row => String(row.status).toUpperCase() === status).length
                return <tr key={team.id}>
                  <th scope="row" title={team.code} style={{ fontSize: '.72rem', whiteSpace: 'nowrap', letterSpacing: '-0.03em', paddingLeft: '.45rem', paddingRight: '.45rem' }}>{team.code}</th>
                  <td><strong>{rows.length.toLocaleString()}</strong></td>
                  <td>{countStatus('COMPLETED').toLocaleString()}</td>
                  <td>{countStatus('INCOMPLETE').toLocaleString()}</td>
                  <td>{countStatus('CANCELED').toLocaleString()}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>}
        <p className="tally-note">These status totals are separate from the manual WTD/MTD daily-count board. They update after a successful import and when the board reloads.</p>
      </div>
      )}

      {tallyView === 'wtd-mtd' && (
      <>
      <div className="tally-summary tally-department-summary">
        <div className="tally-summary-card tally-department-summary-card">
          <div className="muted">Department WTD</div>
          <div className="tally-summary-number">
            {departmentWTD.toLocaleString()}
          </div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Week-to-Date · all active teams
          </div>
        </div>

        <div className="tally-summary-card tally-department-summary-card">
          <div className="muted">Department MTD</div>
          <div className="tally-summary-number">
            {departmentMTD.toLocaleString()}
          </div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Month-to-Date · all active teams
          </div>
        </div>

        <div className="tally-summary-card tally-department-summary-card">
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
              {new Date(`${weekStart}T12:00:00`).toLocaleDateString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric'
              })}
            </h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              Daily counts by team · Monday–Sunday · WTD and MTD calculated automatically
            </p>
          </div>

          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {dates.length} days · scroll inside the table
          </span>
        </div>

        {loading ? (
          <p className="muted">Loading weekly board…</p>
        ) : activeTeams.length === 0 ? (
          <div className="empty">
            No active teams in this department. Add teams in Team Settings first.
          </div>
        ) : (
          <div className="tally-scroll tally-desktop-table" role="region" aria-label="Weekly team tally table" tabIndex={0}>
            <table className="tally-table">
              <thead>
                <tr>
                  <th>Team</th>
                  {dates.map(date => (
                    <th key={date}>
                      <span style={{ display: 'block', fontSize: '0.75rem', opacity: 0.8 }}>
                        {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}
                      </span>
                      {Number(date.slice(8))}
                    </th>
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

        {!loading && activeTeams.length > 0 && (
          <div className="tally-mobile-teams" aria-label="Team tally cards">
            {activeTeams.map(team => (
              <details className="tally-mobile-team" key={team.id} open={!!expandedTeams[team.id]}>
                <summary onClick={event => { event.preventDefault(); setExpandedTeams(current => ({ ...current, [team.id]: !current[team.id] })) }}>
                  <span className="tally-mobile-team-name">{team.code}<small className="muted" style={{display:'block',fontWeight:400,marginTop:'.2rem'}}>{expandedTeams[team.id] ? 'Hide daily counts' : 'Tap to view daily counts'}</small></span>
                  <span className="tally-mobile-totals">
                    <span className="tally-mobile-total"><small>WTD</small><strong>{getWTD(team.id).toLocaleString()}</strong></span>
                    <span className="tally-mobile-total"><small>MTD</small><strong>{getMTD(team.id).toLocaleString()}</strong></span>
                  </span>
                </summary>
                {expandedTeams[team.id] && <div className="tally-mobile-days">
                  {dates.map(date => {
                    const key = dailyKey(team.id, date)
                    return <label className="tally-mobile-day" key={date}>
                      <span><strong>{new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{weekday:'short'})}</strong><small className="muted" style={{display:'block'}}>{Number(date.slice(8))}</small></span>
                      {canEdit ? <input aria-label={`${team.code} count for ${date}`} type="number" min="0" step="1" inputMode="numeric" value={dailyCounts[key] ?? ''} placeholder="0" onChange={event => updateDaily(team.id,date,event.target.value)} onBlur={() => void saveDaily(team.id,date)} /> : <strong>{getCount(team.id,date).toLocaleString()}</strong>}
                    </label>
                  })}
                </div>}
              </details>
            ))}
          </div>
        )}

        <p className="tally-note">
          WTD means Week-to-Date (Monday through the reporting date). MTD means
          Month-to-Date (the first day of the month through the reporting date).
          Historical weeks use Sunday as the reporting date. Totals are
          calculated per team from daily counts; no separate WID/MID entry is needed.
        </p>
      </div>
      <div className="card">
        <div className="tally-month-title">
          <div>
            <h2 style={{ margin: 0 }}>{departments.find(item => item.id === departmentId)?.code ?? 'Department'} — Team Summary</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>Combined installation tally · no individual team breakdown</p>
          </div>
        </div>
        {loading ? <p className="muted">Loading team summary…</p> : (
          <div className="tally-summary">
            {dates.filter(date => date >= weekStart && date <= reportDate).map(date => (
              <div className="tally-summary-card" key={date}>
                <div className="muted">{new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                <div className="tally-summary-number">{departmentDailyTotals[dates.indexOf(date)].toLocaleString()}</div>
              </div>
            ))}
            <div className="tally-summary-card">
              <div className="muted">Selected week total</div>
              <div className="tally-summary-number">{departmentWTD.toLocaleString()}</div>
            </div>
          </div>
        )}
        <p className="tally-note">Combined totals across all active teams in this department. Individual team names and team-by-team rows are hidden from employee view.</p>
      </div>
      </>
      )}
    </section>
  )
}
