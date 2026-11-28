import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://arntn08.github.io'
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function b64url(input: ArrayBuffer | string) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
}
async function googleToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }))
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\\s/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${b64url(sig)}`
    })
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Google token failed')
  return data.access_token as string
}
function colLetter(index: number) {
  let n = index + 1, s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
function cellRef(row: number, col: number) { return `${colLetter(col)}${row + 1}` }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let supa: ReturnType<typeof createClient> | null = null
  let historyId: string | null = null
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ ok: false, error: 'Not signed in.' }, 401)
    supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }
    })
    const { data: userData } = await supa.auth.getUser()
    const user = userData.user
    if (!user) return json({ ok: false, error: 'Not signed in.' }, 401)
    const [{ data: me }, { data: coordinatorAccess }] = await Promise.all([
      supa.from('profiles').select('role,active').eq('id', user.id).maybeSingle(),
      supa.from('project_coordinator_access').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle()
    ])
    const canManageSchedule = !!me?.active && (['owner', 'editor'].includes(me.role) || !!coordinatorAccess)
    if (!canManageSchedule) {
      return json({ ok: false, error: 'Only an active Owner, Editor, or authorized Project Coordinator can change team assignments.' }, 403)
    }

    const body = await req.json()
    const { fileId, tab, dateKey, movedEmployee, movedFromCell, movedFromTeam, replacedEmployee, targetCell, targetTeam, section, role, updates } = body
    if (typeof fileId !== 'string' || typeof tab !== 'string' || !Array.isArray(updates) || updates.length < 1 || updates.length > 2) {
      return json({ ok: false, error: 'Invalid schedule change.' }, 400)
    }
    if (typeof movedEmployee !== 'string' || !movedEmployee.trim() || typeof targetCell !== 'string') {
      return json({ ok: false, error: 'Missing employee or target cell.' }, 400)
    }
    const normalized = updates.map((u: any) => {
      if (!Number.isInteger(u.row) || !Number.isInteger(u.col) || u.row < 0 || u.col < 0 || u.row > 20000 || u.col > 200) throw new Error('Invalid cell coordinate.')
      if (typeof u.old !== 'string' || typeof u.value !== 'string' || u.value.length > 2000 || u.value.trim().startsWith('=')) throw new Error('Invalid cell value.')
      return { row: u.row, col: u.col, old: u.old, value: u.value, section: String(u.section || section || ''), role: String(u.role || role || ''), team: u.team ? String(u.team) : null }
    })
    const refs = normalized.map(u => cellRef(u.row, u.col))
    if (new Set(refs).size !== refs.length) return json({ ok: false, error: 'The same spreadsheet cell cannot be changed twice.' }, 400)
    if (movedFromCell && !refs.includes(movedFromCell)) return json({ ok: false, error: 'Source cell is missing from the change set.' }, 400)
    if (!refs.includes(targetCell)) return json({ ok: false, error: 'Target cell is missing from the change set.' }, 400)

    const { data: file } = await supa.from('files').select('id,kind,sheet_id,title').eq('id', fileId).maybeSingle()
    if (!file || file.kind !== 'gsheet' || !file.sheet_id) return json({ ok: false, error: 'Google Sheet not available.' }, 404)

    const { data: history, error: historyError } = await supa.from('schedule_change_history').insert({
      file_id: file.id, tab, date_key: String(dateKey || tab), actor_id: user.id,
      moved_employee: movedEmployee.trim(), moved_from_cell: movedFromCell || null,
      moved_from_team: movedFromTeam || null, replaced_employee: replacedEmployee || null,
      target_cell: targetCell, target_team: targetTeam || null,
      sync_status: 'pending',
      change_payload: { section: section || '', role: role || '', updates: normalized }
    }).select('id').single()
    if (historyError || !history) return json({ ok: false, error: 'Could not record the change in Supabase. No spreadsheet cells were changed.' }, 500)
    historyId = history.id

    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const token = await googleToken(sa)
    const headers = { Authorization: `Bearer ${token}` }
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${file.sheet_id}`
    const metaRes = await fetch(`${base}?fields=sheets.properties.title`, { headers })
    if (!metaRes.ok) throw new Error('Could not reach the Google spreadsheet.')
    const meta = await metaRes.json()
    const tabs: string[] = (meta.sheets ?? []).map((s: any) => s.properties.title)
    if (!tabs.includes(tab)) throw new Error('Unknown Google Sheet tab.')

    const verified = await Promise.all(normalized.map(async (u) => {
      const a1 = `'${tab.replace(/'/g, "''")}'!${cellRef(u.row, u.col)}`
      const range = encodeURIComponent(a1)
      const [formulaRes, valueRes] = await Promise.all([
        fetch(`${base}/values/${range}?valueRenderOption=FORMULA`, { headers }),
        fetch(`${base}/values/${range}?valueRenderOption=FORMATTED_VALUE`, { headers })
      ])
      if (!formulaRes.ok || !valueRes.ok) throw new Error('Could not verify the current schedule cells.')
      const formulaData = await formulaRes.json()
      const valueData = await valueRes.json()
      const formula = String(formulaData.values?.[0]?.[0] ?? '')
      const current = String(valueData.values?.[0]?.[0] ?? '')
      if (formula.startsWith('=')) throw new Error(`Cell ${cellRef(u.row,u.col)} contains a formula and is protected.`)
      if (current !== u.old) throw new Error(`Schedule conflict at ${cellRef(u.row,u.col)}. Refresh the schedule and try again.`)
      return { range: a1, values: [[u.value]] }
    }))

    const writeRes = await fetch(`${base}/values:batchUpdate`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data: verified })
    })
    if (!writeRes.ok) throw new Error('Google Sheets rejected the changes. The spreadsheet was not updated.')
    const { error: assignmentError } = await supa.from('schedule_daily_assignments').upsert(normalized.map((u) => ({
      file_id: file.id, tab, date_key: String(dateKey || tab), cell_a1: cellRef(u.row,u.col),
      section: u.section, role: u.role, employee_name: u.value.trim() || null,
      employee_team: u.team, updated_by: user.id, updated_at: new Date().toISOString()
    })), { onConflict: 'file_id,tab,cell_a1' })
    if (assignmentError) {
      await supa.from('schedule_change_history').update({ sync_status: 'partial', sync_error: 'Google Sheets updated, but Supabase daily assignment state could not be updated.' }).eq('id', historyId)
      return json({ ok: false, partial: true, error: 'Google Sheets updated, but Supabase could not save the daily assignment state. Contact the Owner before making another change.' }, 502)
    }
    const { error: finishError } = await supa.from('schedule_change_history').update({ sync_status: 'synced' }).eq('id', historyId)
    if (finishError) return json({ ok: false, partial: true, error: 'Google Sheets and daily assignment state updated, but history sync status could not be finalized.' }, 502)
    await supa.from('audit_logs').insert({
      user_id: user.id, action: 'schedule_replacement', file_id: file.id,
      detail: { title: `${file.title} (${tab})`, movedEmployee, movedFromCell, targetCell, replacedEmployee, targetTeam }
    })
    return json({ ok: true, historyId, updatedCells: refs })
  } catch (error) {
    if (supa && historyId) {
      await supa.from('schedule_change_history').update({
        sync_status: 'failed',
        sync_error: error instanceof Error ? error.message : 'Unknown schedule sync error.'
      }).eq('id', historyId)
    }
    return json({ ok: false, error: error instanceof Error ? error.message : 'Could not sync schedule change.' }, 409)
  }
})