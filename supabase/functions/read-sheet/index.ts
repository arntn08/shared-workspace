import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const ALLOWED_ORIGIN = 'https://arntn08.github.io'
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s)
function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ ok: false, error: 'Not signed in.' })
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supa = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: u } = await supa.auth.getUser()
    if (!u.user) return json({ ok: false, error: 'Not signed in.' })
    const { data: me } = await supa.from('profiles').select('role,active').eq('id', u.user.id).maybeSingle()
    if (!me || !me.active || (me.role !== 'owner' && me.role !== 'editor')) return json({ ok: false, error: 'Only the owner or an editor can send updates.' })

    const admin = createClient(url, serviceKey)
    const body = await req.json()
    const action = String(body.action ?? '')

    const kick = () => {
      const p = fetch(`${url}/functions/v1/notify-dispatch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'x-dispatch-secret': Deno.env.get('DISPATCH_SECRET') ?? '', 'Content-Type': 'application/json' },
        body: '{}'
      }).catch(() => {})
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p)
    }

    if (action === 'retry') {
      if (!isUuid(body.update_id)) return json({ ok: false, error: 'Invalid update.' })
      await admin.from('notifications').update({ email_status: 'pending' }).eq('update_id', body.update_id).eq('email_status', 'failed')
      await admin.from('notifications').update({ push_status: 'pending' }).eq('update_id', body.update_id).eq('push_status', 'failed')
      kick()
      return json({ ok: true })
    }
    if (action !== 'preview' && action !== 'send') return json({ ok: false, error: 'Unknown action.' })

    // ---- validate input ----
    const { data: file } = await admin.from('files').select('id,title').eq('id', body.file_id).maybeSingle()
    if (!file) return json({ ok: false, error: 'Choose a file.' })
    if (!isIsoDate(body.effective_date)) return json({ ok: false, error: 'Choose a valid date.' })
    const year = Number(body.effective_date.slice(0, 4))
    const thisYear = new Date().getUTCFullYear()
    if (year < thisYear - 1 || year > thisYear + 2) return json({ ok: false, error: 'That year looks wrong. Please check the date.' })
    const text = String(body.action_text ?? '').trim().slice(0, 500)
    let remindAt: string | null = null
    if (body.remind_at) {
      const t = new Date(String(body.remind_at))
      if (isNaN(t.getTime()) || t.getTime() < Date.now() + 30000) return json({ ok: false, error: 'The reminder time must be in the future.' })
      remindAt = t.toISOString()
    }
    const teams: string[] = Array.isArray(body.teams) ? body.teams.map(String).slice(0, 20) : []
    const users: string[] = Array.isArray(body.users) ? body.users.filter(isUuid).slice(0, 500) : []
    const grant = body.grant_access === true

    // ---- resolve recipients (explicit choice, otherwise everyone who can see the file) ----
    const { data: assigned } = await admin.from('assignments').select('user_id').eq('file_id', file.id)
    const hasAccess = new Set((assigned ?? []).map((a: any) => a.user_id as string))
    const ids = new Set<string>()
    if (teams.length === 0 && users.length === 0) hasAccess.forEach((i) => ids.add(i))
    else {
      if (teams.length) {
        const { data } = await admin.from('profiles').select('id').eq('role', 'employee').eq('active', true).overlaps('teams', teams)
        ;(data ?? []).forEach((p: any) => ids.add(p.id))
      }
      users.forEach((i) => ids.add(i))
    }
    if (ids.size === 0) return json({ ok: false, error: 'No recipients. Pick a team or person, or share the file first.' })
    const { data: people } = await admin
      .from('profiles')
      .select('id,email,full_name')
      .in('id', [...ids])
      .eq('role', 'employee')
      .eq('active', true)
    const all = people ?? []
    const { data: prefRows } = await admin.from('notification_prefs').select('*').in('user_id', all.map((p: any) => p.id))
    const { data: subRows } = await admin.from('push_subscriptions').select('user_id').in('user_id', all.map((p: any) => p.id))
    const prefs = new Map((prefRows ?? []).map((p: any) => [p.user_id as string, p]))
    const subs = new Set((subRows ?? []).map((s: any) => s.user_id as string))
    const pref = (id: string) => prefs.get(id) ?? { cat_file_updates: true, cat_reminders: true, email_enabled: true, push_enabled: false }

    const recs = all.map((p: any) => ({
      id: p.id as string,
      name: (p.full_name || p.email) as string,
      email: p.email as string,
      access: hasAccess.has(p.id),
      optedOut: !pref(p.id).cat_file_updates && !(remindAt && pref(p.id).cat_reminders),
      push: !!pref(p.id).push_enabled && subs.has(p.id),
      mail: !!pref(p.id).email_enabled
    }))
    const excluded = grant ? [] : recs.filter((r) => !r.access)
    const sendTo = recs.filter((r) => (grant || r.access) && !r.optedOut)
    const warnings: string[] = []
    if (excluded.length) warnings.push(`${excluded.length} recipient(s) cannot open this file and will be skipped unless you tick "also share the file".`)
    if (recs.some((r) => r.optedOut)) warnings.push('Some people turned these notifications off and will be skipped.')

    if (action === 'preview') {
      return json({
        ok: true,
        recipients: recs,
        warnings,
        counts: { send: sendTo.length, optedOut: recs.filter((r) => r.optedOut).length, noAccess: excluded.length, push: sendTo.filter((r) => r.push).length, email: sendTo.filter((r) => r.mail).length }
      })
    }

    // ---- send (idempotent) ----
    if (!isUuid(body.request_id)) return json({ ok: false, error: 'Missing request id. Reload the page.' })
    if (sendTo.length === 0) return json({ ok: false, error: 'Nobody would receive this update.' })

    const { data: dup } = await admin
      .from('file_updates')
      .select('id')
      .eq('file_id', file.id)
      .eq('effective_date', body.effective_date)
      .eq('action', text)
      .eq('created_by', u.user.id)
      .gte('created_at', new Date(Date.now() - 120000).toISOString())
      .maybeSingle()
    if (dup) return json({ ok: true, duplicate: true, update_id: dup.id })

    const { data: upd, error: ue } = await admin
      .from('file_updates')
      .insert({ request_id: body.request_id, file_id: file.id, created_by: u.user.id, effective_date: body.effective_date, action: text, remind_at: remindAt, target_teams: teams, target_users: users })
      .select('id')
      .maybeSingle()
    if (ue || !upd) {
      if (ue?.code === '23505') {
        const { data: ex } = await admin.from('file_updates').select('id').eq('request_id', body.request_id).maybeSingle()
        return json({ ok: true, duplicate: true, update_id: ex?.id })
      }
      return json({ ok: false, error: 'Could not save the update.' })
    }

    if (grant) {
      const missing = sendTo.filter((r) => !r.access).map((r) => ({ file_id: file.id, user_id: r.id }))
      if (missing.length) await admin.from('assignments').upsert(missing, { onConflict: 'file_id,user_id', ignoreDuplicates: true })
    }

    const bodyText = text || 'Please review the updated file.'
    const rows: Record<string, unknown>[] = []
    for (const r of sendTo) {
      const p = pref(r.id)
      if (p.cat_file_updates) {
        rows.push({ user_id: r.id, update_id: upd.id, file_id: file.id, kind: 'file_update', title: `${file.title} was updated`, body: bodyText, due_on: body.effective_date, deliver_at: new Date().toISOString(), dedupe_key: `${upd.id}:u` })
      }
      if (remindAt && p.cat_reminders) {
        rows.push({ user_id: r.id, update_id: upd.id, file_id: file.id, kind: 'reminder', title: `Reminder: ${file.title}`, body: bodyText, due_on: body.effective_date, deliver_at: remindAt, dedupe_key: `${upd.id}:r` })
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin.from('notifications').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
      if (error) return json({ ok: false, error: 'Saved the update but could not create all notifications.', update_id: upd.id })
    }
    await admin.from('audit_logs').insert({ user_id: u.user.id, action: 'send_update', file_id: file.id, detail: { title: file.title, recipients: sendTo.length } })
    kick()
    return json({ ok: true, update_id: upd.id, notified: sendTo.length, skipped: recs.length - sendTo.length })
  } catch (_e) {
    return json({ ok: false, error: 'Server error.' })
  }
})
