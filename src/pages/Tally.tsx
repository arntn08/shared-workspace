
import { useCallback, useEffect, useMemo, useState } from 'react'
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

const getMonthDates = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number)
  const days = new Date(year, monthNumber, 0).getDate()

  return Array.from({ length: days }, (_, index) =>
    `${month}-${String(index + 1).padStart(2, '0')}`
  )
}

type ImportedWorkOrderRow = { work_date: string; team_id: string | null; department_id: string | null; status: string; wo_id: string }

async function fetchImportedWorkOrders(start: string, end: string): Promise<ImportedWorkOrderRow[]> {
  const pageSize = 1000
  const allRows: ImportedWorkOrderRow[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('installation_imported_work_orders')
      .select('work_date,team_id,department_id,status,wo_id')
      .gte('work_date', start)
      .lte('work_date', end)
      .order('wo_id')
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = (data ?? []) as ImportedWorkOrderRow[]
    allRows.push(...page)
    if (page.length < pageSize) return allRows
  }
}

const formatDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  const [weekOffset, setWeekOffset] = useState(() => {
    const day = new Date().getDate()
    return day <= 8 ? 0 : day <= 15 ? 1 : day <= 22 ? 2 : 3
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importing, setImporting] = useState(false)
  const [importedLoads, setImportedLoads] = useState<Array<{work_date:string; team_id:string|null; department_id:string|null; status:string; wo_id:string}>>([])
  const [loadBreakdownError, setLoadBreakdownError] = useState('')
  const [tallyView, setTallyView] = useState<'wtd-mtd' | 'total-loads'>('wtd-mtd')
  const [quotaOpen, setQuotaOpen] = useState(false)

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
  // Monthly reporting blocks intentionally stay inside the calendar month:
  // Nov 1–8, Nov 9–15, Nov 16–22, then Nov 23–month-end.
  const periodStartDay = Math.min(weekOffset === 0 ? 1 : 2 + weekOffset * 7, Number(monthEnd.slice(-2)))
  const weekStart = `${month}-${String(periodStartDay).padStart(2, '0')}`
  const dates = useMemo(
    () => Array.from(
      { length: Math.min(weekOffset === 0 ? 8 : 7, Number(monthEnd.slice(-2)) - periodStartDay + 1) },
      (_, index) => addDays(weekStart, index)
    ),
    [monthEnd, periodStartDay, weekStart]
  )
  const weekEnd = dates[dates.length - 1]
  const nowDate = formatDate(new Date())
  const reportDate = nowDate < weekStart ? weekStart : nowDate > weekEnd ? weekEnd : nowDate
  // Imported records and every displayed date are scoped to the selected month.
  const importedStart = monthStart
  const importedEnd = monthEnd

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
        setImportedLoads([])
        return
      }

      try {
        setImportedLoads(await fetchImportedWorkOrders(importedStart, importedEnd))
        setLoadBreakdownError('')
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Unknown database error'
        setImportedLoads([])
        setLoadBreakdownError(
          message.includes('installation_imported_work_orders')
            ? 'The imported-work-orders table is not available yet. Run the supplied Supabase SQL, then refresh.'
            : `Could not load imported status totals: ${message}`
        )
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
  }, [departmentId, importedEnd, importedStart, monthEnd, monthStart, weekStart, weekEnd])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  // Keep the selected month and reporting-week work orders fresh.
  useEffect(() => {
    const refreshImportedLoads = async () => {
      try {
        setImportedLoads(await fetchImportedWorkOrders(importedStart, importedEnd))
        setLoadBreakdownError('')
      } catch (loadError) {
        setLoadBreakdownError(loadError instanceof Error ? loadError.message : 'Could not refresh imported status totals.')
      }
    }
    const timer = window.setInterval(() => { void refreshImportedLoads() }, 30000)
    return () => window.clearInterval(timer)
  }, [importedEnd, importedStart])

  function changeWeek(offset: number) {
    // Each selected reporting block belongs to one month only.
    let targetMonth = month
    let targetOffset = weekOffset + offset
    if (targetOffset < 0) {
      const [year, monthNumber] = month.split('-').map(Number)
      const previous = new Date(year, monthNumber - 2, 1)
      targetMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`
      targetOffset = 3
    } else if (targetOffset > 3) {
      const [year, monthNumber] = month.split('-').map(Number)
      const next = new Date(year, monthNumber, 1)
      targetMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
      targetOffset = 0
    }
    setMonth(targetMonth)
    setWeekOffset(targetOffset)
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
          })), { onConflict: 'wo_id' })
        if (recordsError) throw recordsError
      }

      setMessage(`Imported ${importPreview.workOrders.length.toLocaleString()} work-order rows. WTD/MTD and Total Loads now recalculate from unique imported work orders.`)
      setImportPreview(null)
      await loadBoard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import completed installations.')
    } finally {
      setImporting(false)
    }
  }

  // Count each WO ID once, regardless of duplicate imports.
  const uniqueImportedLoads = useMemo(() => {
    const seen = new Set<string>()
    return importedLoads.filter(row => {
      const woId = String(row.wo_id ?? '').trim().toUpperCase()
      if (!woId || seen.has(woId)) return false
      seen.add(woId)
      return true
    })
  }, [importedLoads])

  const departmentTeamIds = useMemo(
    () => new Set(teams.filter(team => team.department_id === departmentId).map(team => team.id)),
    [teams, departmentId]
  )

  const monthLoads = useMemo(
    () => uniqueImportedLoads.filter(row =>
      row.work_date >= monthStart &&
      row.work_date <= monthEnd &&
      Boolean(row.team_id && departmentTeamIds.has(row.team_id)) &&
      ['COMPLETED', 'INCOMPLETE', 'CANCELED'].includes(String(row.status).trim().toUpperCase())
    ),
    [uniqueImportedLoads, monthStart, monthEnd, departmentTeamIds]
  )

  function getCount(teamId: string, date: string) {
    return uniqueImportedLoads.filter(row =>
      row.team_id === teamId && row.work_date === date &&
      String(row.status).trim().toUpperCase() === 'COMPLETED'
    ).length
  }

  function getWTD(teamId: string) {
    return uniqueImportedLoads.filter(row =>
      row.team_id === teamId && row.work_date >= weekStart && row.work_date <= reportDate &&
      String(row.status).trim().toUpperCase() === 'COMPLETED'
    ).length
  }

  function getMTD(teamId: string) {
    const monthReportEnd = reportDate < monthEnd ? reportDate : monthEnd
    return uniqueImportedLoads.filter(row =>
      row.team_id === teamId && row.work_date >= monthStart && row.work_date <= monthReportEnd &&
      String(row.status).trim().toUpperCase() === 'COMPLETED'
    ).length
  }

  const departmentWTD = activeTeams.reduce((sum, team) => sum + getWTD(team.id), 0)
  const departmentMTD = activeTeams.reduce((sum, team) => sum + getMTD(team.id), 0)
  const completedInstalled = monthLoads.filter(row => String(row.status).trim().toUpperCase() === 'COMPLETED').length
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
    [dates, activeTeams, uniqueImportedLoads]
  )

  function exportMonthlyExcel() {
    const monthOrders = uniqueImportedLoads.filter(row =>
      row.work_date >= monthStart &&
      row.work_date <= monthEnd &&
      ['COMPLETED', 'INCOMPLETE', 'CANCELED'].includes(String(row.status).trim().toUpperCase())
    )
    const teamsWithRecords = new Set(monthOrders.map(row => row.team_id).filter((id): id is string => Boolean(id)))
    const exportTeams = teams
      .filter(team => team.active || teamsWithRecords.has(team.id))
      .sort((a, b) =>
        (departments.find(d => d.id === a.department_id)?.code ?? '').localeCompare(departments.find(d => d.id === b.department_id)?.code ?? '') ||
        a.code.localeCompare(b.code)
      )
    const dateSerial = (value: string) => {
      const [year, monthNumber, day] = value.split('-').map(Number)
      return Math.floor(Date.UTC(year, monthNumber - 1, day) / 86400000) + 25569
    }
    const countIfs = (summaryRow: number, dateCell?: string, status?: string) => {
      const criteria = [
        `'Work Order Records'!$B:$B,$A${summaryRow}`,
        `'Work Order Records'!$C:$C,$B${summaryRow}`
      ]
      if (dateCell) criteria.push(`'Work Order Records'!$A:$A,">="&${dateCell}`, `'Work Order Records'!$A:$A,"<"&${dateCell}+1`)
      if (status) criteria.push(`'Work Order Records'!$E:$E,"${status}"`)
      return `COUNTIFS(${criteria.join(',')})`
    }
    const workOrderRows: unknown[][] = [
      ['Work date', 'Department', 'Team', 'WO ID', 'Status', 'Notes (editable)'],
      ...monthOrders.map(row => [
        { t: 'n', v: dateSerial(row.work_date), z: 'dd-mmm-yyyy' },
        departments.find(d => d.id === row.department_id)?.code ?? '—',
        teams.find(t => t.id === row.team_id)?.code ?? 'Unassigned',
        row.wo_id,
        String(row.status).trim().toUpperCase(),
        ''
      ])
    ]
    const recordsSheet = XLSX.utils.aoa_to_sheet(workOrderRows)
    recordsSheet['!cols'] = [{ wch: 16 }, { wch: 15 }, { wch: 18 }, { wch: 25 }, { wch: 16 }, { wch: 34 }]
    recordsSheet['!autofilter'] = { ref: `A1:F${Math.max(1, workOrderRows.length)}` }
    recordsSheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }

    const firstDayColumn = 3
    const lastDayColumn = firstDayColumn + monthDates.length - 1
    const mtdColumn = lastDayColumn + 1
    const incompleteColumn = mtdColumn + 1
    const canceledColumn = incompleteColumn + 1
    const totalColumn = canceledColumn + 1
    const columnLetter = (index: number) => XLSX.utils.encode_col(index)
    const summaryRows: unknown[][] = [
      ['AHBA DEVELOPMENT · INSTALLATION TALLY', 'Month', { t: 'n', v: dateSerial(monthStart), z: 'mmmm yyyy' }, 'Generated', { t: 'n', v: dateSerial(formatDate(new Date())), z: 'dd-mmm-yyyy' }],
      ['Edit dates, team labels, statuses, or notes in Work Order Records. Summary formulas recalculate in Excel.'],
      ['Department', 'Team', 'Team name', ...monthDates.map(date => ({ t: 'n', v: dateSerial(date), z: 'ddd, dd-mmm' })), 'Completed MTD', 'Incomplete', 'Canceled', 'Total Loads']
    ]
    exportTeams.forEach(team => {
      const rowNumber = summaryRows.length + 1
      const departmentCode = departments.find(d => d.id === team.department_id)?.code ?? '—'
      const dailyFormulas = monthDates.map((_, dayIndex) => {
        const dateColumn = columnLetter(firstDayColumn + dayIndex)
        return { t: 'n', f: countIfs(rowNumber, `${dateColumn}$3`, 'COMPLETED'), v: monthOrders.filter(row => row.team_id === team.id && row.work_date === monthDates[dayIndex] && String(row.status).trim().toUpperCase() === 'COMPLETED').length, z: '0' }
      })
      const mtdLetter = columnLetter(mtdColumn)
      const incompleteLetter = columnLetter(incompleteColumn)
      const canceledLetter = columnLetter(canceledColumn)
      const totalLetter = columnLetter(totalColumn)
      const lastDailyLetter = columnLetter(lastDayColumn)
      const completed = monthOrders.filter(row => row.team_id === team.id && String(row.status).trim().toUpperCase() === 'COMPLETED').length
      const incomplete = monthOrders.filter(row => row.team_id === team.id && String(row.status).trim().toUpperCase() === 'INCOMPLETE').length
      const canceled = monthOrders.filter(row => row.team_id === team.id && String(row.status).trim().toUpperCase() === 'CANCELED').length
      summaryRows.push([
        departmentCode,
        team.code,
        team.name,
        ...dailyFormulas,
        { t: 'n', f: `SUM(D${rowNumber}:${lastDailyLetter}${rowNumber})`, v: completed, z: '0' },
        { t: 'n', f: countIfs(rowNumber, undefined, 'INCOMPLETE'), v: incomplete, z: '0' },
        { t: 'n', f: countIfs(rowNumber, undefined, 'CANCELED'), v: canceled, z: '0' },
        { t: 'n', f: `${mtdLetter}${rowNumber}+${incompleteLetter}${rowNumber}+${canceledLetter}${rowNumber}`, v: completed + incomplete + canceled, z: '0' }
      ])
    })
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
    summarySheet['!cols'] = [{ wch: 15 }, { wch: 18 }, { wch: 26 }, ...monthDates.map(() => ({ wch: 13 })), { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 15 }]
    summarySheet['!autofilter'] = { ref: `A3:${columnLetter(totalColumn)}${summaryRows.length}` }
    summarySheet['!freeze'] = { xSplit: 3, ySplit: 3, topLeftCell: 'D4', activePane: 'bottomRight', state: 'frozen' }

    const dailyRows: unknown[][] = [
      ['Work date', 'Department', 'Team', 'Completed', 'Incomplete', 'Canceled', 'Total Loads']
    ]
    for (const team of exportTeams) {
      const departmentCode = departments.find(d => d.id === team.department_id)?.code ?? '—'
      for (const date of monthDates) {
        const matching = monthOrders.filter(row => row.team_id === team.id && row.work_date === date)
        const completed = matching.filter(row => String(row.status).trim().toUpperCase() === 'COMPLETED').length
        const incomplete = matching.filter(row => String(row.status).trim().toUpperCase() === 'INCOMPLETE').length
        const canceled = matching.filter(row => String(row.status).trim().toUpperCase() === 'CANCELED').length
        if (completed + incomplete + canceled > 0) dailyRows.push([
          { t: 'n', v: dateSerial(date), z: 'dd-mmm-yyyy' }, departmentCode, team.code,
          completed, incomplete, canceled, completed + incomplete + canceled
        ])
      }
    }
    const dailySheet = XLSX.utils.aoa_to_sheet(dailyRows)
    dailySheet['!cols'] = [{ wch: 16 }, { wch: 15 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 15 }]
    dailySheet['!autofilter'] = { ref: `A1:G${dailyRows.length}` }
    dailySheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }

    const workbook = XLSX.utils.book_new()
    workbook.Props = {
      Title: `AHBA Installation Tally ${month}`,
      Subject: 'Editable full-month installation tally and work-order register',
      Author: 'AHBA Development',
      Company: 'AHBA Development',
      CreatedDate: new Date()
    }
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Monthly Tally')
    XLSX.utils.book_append_sheet(workbook, dailySheet, 'Daily Breakdown')
    XLSX.utils.book_append_sheet(workbook, recordsSheet, 'Work Order Records')
    XLSX.writeFile(workbook, `AHBA-Installation-Tally-${month}.xlsx`, { cellDates: false, compression: true })
  }

  function exportCsv() {
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
    const rows: (string | number)[][] = [['Team', ...dates, 'WTD (selected period)', 'MTD']]
    activeTeams.forEach(team => rows.push([team.code, ...dates.map(date => getCount(team.id, date)), getWTD(team.id), getMTD(team.id)]))
    const csv = rows.map(row => row.map(escapeCsv).join(',')).join('\\r\\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `installation-tally-${month}-${departments.find(item => item.id === departmentId)?.code ?? 'department'}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
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
        .tally-page .tally-mobile-team {
          border: 1px solid var(--tally-border);
          border-radius: 12px;
          background: var(--tally-card);
          margin: 0;
          min-width: 0;
          overflow: hidden;
          align-self: start;
        }
        .tally-page .tally-mobile-team summary {
          list-style: none;
          cursor: pointer;
          padding: .6rem .65rem;
          display: grid;
          grid-template-columns: minmax(0,1fr) auto;
          gap: .4rem;
          align-items: center;
        }
        .tally-page .tally-mobile-team summary::-webkit-details-marker { display:none; }
        .tally-page .tally-mobile-team-name { font-size: .82rem; font-weight: 800; overflow-wrap:anywhere; line-height:1.2; }
        .tally-page .tally-mobile-totals { display:flex; gap:.3rem; }
        .tally-page .tally-mobile-total { min-width: 42px; text-align:center; border-radius:8px; background:var(--tally-soft); padding:.28rem .35rem; }
        .tally-page .tally-mobile-total strong { display:block; color:var(--tally-accent); font-size:.92rem; line-height:1.15; }
        .tally-page .tally-mobile-total small { font-size:.6rem; }
        .tally-page .tally-mobile-days { padding: 0 .5rem .5rem; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.3rem; }
        .tally-page .tally-mobile-day {
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items:center;
          gap:.12rem;
          min-width:0;
          border-radius:8px;
          background:var(--tally-soft);
          padding:.3rem .15rem;
          font-size:.72rem;
        }
        .tally-page .tally-mobile-day input { width:100%; max-width:100%; min-height:32px; text-align:center; border:1px solid var(--tally-border); border-radius:7px; background:var(--tally-card); color:var(--text); font-size:.82rem; }
        @media (max-width: 600px) {
          .tally-page .tally-mobile-teams {
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:.45rem;
            align-items:start;
          }
          .tally-page .tally-desktop-table { display:none; }
          .tally-page .tally-month-title { align-items:flex-start; }
          .tally-page .tally-month-title > span { display:none; }
          .tally-page .tally-mobile-totals { gap:.25rem; }
          .tally-page .tally-mobile-total { min-width:38px; padding:.25rem .3rem; }
          .tally-page .tally-mobile-team summary { padding:.5rem; grid-template-columns:minmax(0,1fr) auto; gap:.25rem; }
          .tally-page .tally-mobile-team-name { font-size:.74rem; }
          .tally-page .tally-mobile-team-name small { font-size:.58rem; margin-top:.12rem !important; }
          .tally-page .tally-mobile-days { grid-template-columns:repeat(4,minmax(0,1fr)); gap:.25rem; padding:.05rem .35rem .4rem; }
          .tally-page .tally-mobile-day { font-size:.65rem; padding:.25rem .08rem; }
          .tally-page .tally-toolbar { grid-template-columns:1fr; }
        }
        @media (max-width: 350px) {
          .tally-page .tally-mobile-teams { grid-template-columns:1fr; }
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
          {canEdit && <>
            <button type="button" className="btn primary" onClick={exportMonthlyExcel} disabled={loading || teams.length === 0}>
              Export full month · Excel
            </button>
            <button type="button" className="btn" onClick={exportCsv} disabled={loading || activeTeams.length === 0}>
              Export current view · CSV
            </button>
          </>}
        </div>
      </div>

      <div className="tally-subtabs" style={{display:'flex',gap:'.6rem',marginBottom:'1rem',flexWrap:'wrap'}}>
        <button type="button" className={quotaOpen?'btn':'btn secondary'} onClick={()=>setQuotaOpen(true)}>Monthly Team Quota · View table</button>
      </div>
      {quotaOpen&&<div className="tally-quota-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setQuotaOpen(false)}}>
        <section className="card tally-quota-modal" role="dialog" aria-modal="true" aria-label="Monthly team quota">
          <div style={{display:'flex',justifyContent:'space-between',gap:'.75rem',alignItems:'center',flexWrap:'wrap'}}>
            <div><h2 style={{margin:0,fontSize:'1.05rem'}}>Monthly team quota</h2><p className="muted" style={{margin:'.2rem 0 0'}}>Target: 50 installations per team · {month}</p></div>
            <div style={{display:'flex',alignItems:'center',gap:'.75rem'}}><strong>{activeTeams.filter(team=>getMTD(team.id)>=50).length} / {activeTeams.length} teams at quota</strong><button type="button" className="btn secondary" onClick={()=>setQuotaOpen(false)}>Close ✕</button></div>
          </div>
          <div style={{overflowX:'auto',marginTop:'.8rem'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.9rem'}}>
              <thead><tr><th style={{textAlign:'left',padding:'.55rem'}}>Team</th><th style={{textAlign:'right',padding:'.55rem'}}>Team Total</th><th style={{textAlign:'right',padding:'.55rem'}}>Shortfall</th><th style={{textAlign:'left',padding:'.55rem'}}>Status</th></tr></thead>
              <tbody>{activeTeams.map(team=>{const total=getMTD(team.id);const shortfall=Math.max(0,50-total);const critical=total<=20;const nte=total<=30;const below=total<50;return <tr key={team.id} style={{background:critical?'rgba(220,38,38,.16)':nte?'rgba(220,38,38,.10)':below?'rgba(217,119,6,.08)':'rgba(22,163,74,.07)',borderTop:'1px solid var(--border)'}}>
                <th scope="row" style={{textAlign:'left',padding:'.65rem',fontWeight:800}}>{team.code} · {team.name}</th><td style={{textAlign:'right',padding:'.65rem',fontWeight:900,fontVariantNumeric:'tabular-nums'}}>{total}</td><td style={{textAlign:'right',padding:'.65rem',fontVariantNumeric:'tabular-nums'}}>{shortfall}</td><td style={{padding:'.65rem',fontWeight:800,color:critical?'#dc2626':nte?'#dc2626':below?'#b7791f':'#16834a'}}>{critical?'NTE + Disciplinary Action':nte?'Subject for NTE':below?'Below quota':'Quota'}</td>
              </tr>})}</tbody>
            </table>
          </div>
          <p className="muted" style={{fontSize:'.76rem',margin:'.65rem 0 0'}}>Red: 30 or fewer installations (shortfall 20+). 20 or fewer (shortfall 30+) receives the higher-priority NTE and disciplinary-action indicator. These are monitoring flags, not automatic sanctions.</p>
        </section>
      </div>}

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
                Incomplete and canceled rows are retained for Total Loads, but do not contribute to WTD/MTD. Other statuses are excluded from Total Loads. Unmatched team codes and invalid dates are excluded and shown below when detected.
              </p>
            </div>
          </div>
          <p className="tally-note">
            WTD/MTD count only rows with STATUS = COMPLETED. Completed, incomplete, and canceled work orders are saved individually for their Total Loads breakdown. Other statuses are excluded from Total Loads.
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
              ? 'Enter a daily count and leave the field to save. Reporting periods stay within the selected month (1–8, 9–15, 16–22, 23–month-end). WTD covers the selected period; MTD always starts on day 1 of that month.'
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
            ['Total load', ['COMPLETED','INCOMPLETE','CANCELED']],
            ['Completed', ['COMPLETED']],
            ['Incomplete', ['INCOMPLETE']],
            ['Canceled', ['CANCELED']]
          ] as Array<[string,string[]]>).map(([label,statuses]) => {
            const count = monthLoads.filter(row =>
              statuses.includes(String(row.status).trim().toUpperCase())
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
                const rows = monthLoads.filter(row => row.team_id === team.id)
                const countStatus = (status: string) => rows.filter(row => String(row.status).trim().toUpperCase() === status).length
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
        <p className="tally-note">Total Loads includes unique work orders marked COMPLETED, INCOMPLETE, or CANCELED. WTD/MTD count only COMPLETED work orders.</p>
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
            Selected in-month reporting period · all active teams
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
              Daily counts by team · dates stay within the selected month · WTD and MTD calculated automatically
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

                    {dates.map(date => (
                      <td key={date}>
                        <strong title={`${team.code} · ${date} · completed work orders`}>
                          {getCount(team.id, date).toLocaleString()}
                        </strong>
                      </td>
                    ))}

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
                  {dates.map(date => (
                    <div className="tally-mobile-day" key={date}>
                      <span><strong>{new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{weekday:'short'})}</strong><small className="muted" style={{display:'block'}}>{Number(date.slice(8))}</small></span>
                      <strong>{getCount(team.id,date).toLocaleString()}</strong>
                    </div>
                  ))}
                </div>}
              </details>
            ))}
          </div>
        )}

        <p className="tally-note">
          WTD means Week-to-Date within the selected in-month reporting period. MTD means
          Month-to-Date from the 1st through the reporting date, never including dates
          from the previous or following month. Totals are
          calculated from unique imported work orders marked COMPLETED. Incomplete and canceled work orders are shown only in Total Loads.
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
