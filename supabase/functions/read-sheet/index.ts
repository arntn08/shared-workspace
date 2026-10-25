import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

type Col = 'push_status' | 'email_status'

Deno.serve(async (req) => {
  const secret = Deno.env.get('DISPATCH_SECRET')
  if (!secret || req.headers.get('x-dispatch-secret') !== secret) return json({ ok: false, error: 'Unauthorized' }, 401)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const appUrl = Deno.env.get('APP_URL') ?? 'https://arntn08.github.io/shared-workspace/'
  const vapidPub = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  const pushReady = !!(vapidPub && vapidPriv && vapidSubject)
  if (pushReady) webpush.setVapidDetails(vapidSubject!, vapidPub!, vapidPriv!)
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const mailFrom = Deno.env.get('MAIL_FROM')

  const now = new Date().toISOString()
  const stale = new Date(Date.now() - 10 * 60000).toISOString()
  await sb.from('notifications').update({ email_status: 'pending' }).eq('email_status', 'sending').lt('claimed_at', stale)
  await sb.from('notifications').update({ push_status: 'pending' }).eq('push_status', 'sending').lt('claimed_at', stale)

  // Atomically claim due rows so two runs never process the same notification.
  async function claim(col: Col) {
    const { data: ids } = await sb.from('notifications').select('id').eq(col, 'pending').lte('deliver_at', now).order('deliver_at').limit(200)
    const list = (ids ?? []).map((r: any) => r.id as string)
    if (!list.length) return [] as any[]
    const { data } = await sb.from('notifications').update({ [col]: 'sending', claimed_at: now }).in('id', list).eq(col, 'pending').select('id,user_id,title,body,dedupe_key')
    return (data ?? []) as any[]
  }
  async function finish(id: string, col: Col, status: string, err?: string) {
    const patch: Record<string, unknown> = { [col]: status }
    if (err) patch.delivery_error = `${col === 'push_status' ? 'Push' : 'Email'}: ${err}`.slice(0, 300)
    await sb.from('notifications').update(patch).eq('id', id)
  }

  const out = { push: { sent: 0, failed: 0, skipped: 0 }, email: { sent: 0, failed: 0, skipped: 0 } }

  // ---- push ----
  const pushRows = await claim('push_status')
  if (pushRows.length) {
    const uids = [...new Set(pushRows.map((r) => r.user_id as string))]
    const [{ data: prefs }, { data: subs }] = await Promise.all([
      sb.from('notification_prefs').select('user_id,push_enabled').in('user_id', uids),
      sb.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', uids)
    ])
    const on = new Set((prefs ?? []).filter((p: any) => p.push_enabled).map((p: any) => p.user_id))
    for (const n of pushRows) {
      const mine = (subs ?? []).filter((s: any) => s.user_id === n.user_id)
      if (!pushReady) { await finish(n.id, 'push_status', 'skipped', 'VAPID keys are not configured'); out.push.skipped++; continue }
      if (!on.has(n.user_id) || mine.length === 0) { await finish(n.id, 'push_status', 'skipped'); out.push.skipped++; continue }
      let ok = 0
      let last = ''
      for (const s of mine) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: n.title, body: n.body, tag: n.dedupe_key, url: `${appUrl}#/notifications` }),
            { TTL: 86400 }
          )
          ok++
        } catch (e: any) {
          last = String(e?.statusCode ?? e?.message ?? e)
          if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from('push_subscriptions').delete().eq('id', s.id)
        }
      }
      if (ok > 0) { await finish(n.id, 'push_status', 'sent'); out.push.sent++ }
      else { await finish(n.id, 'push_status', 'failed', last); out.push.failed++ }
    }
  }

  // ---- email ----
  const mailRows = await claim('email_status')
  if (mailRows.length) {
    const uids = [...new Set(mailRows.map((r) => r.user_id as string))]
    const [{ data: prefs }, { data: profs }] = await Promise.all([
      sb.from('notification_prefs').select('user_id,email_enabled').in('user_id', uids),
      sb.from('profiles').select('id,email').in('id', uids)
    ])
    const off = new Set((prefs ?? []).filter((p: any) => p.email_enabled === false).map((p: any) => p.user_id))
    const emailOf = new Map((profs ?? []).map((p: any) => [p.id as string, p.email as string]))
    for (const n of mailRows) {
      const to = emailOf.get(n.user_id)
      if (!resendKey || !mailFrom) { await finish(n.id, 'email_status', 'skipped', 'Email provider is not configured'); out.email.skipped++; continue }
      if (off.has(n.user_id) || !to) { await finish(n.id, 'email_status', 'skipped'); out.email.skipped++; continue }
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `${n.dedupe_key}:${n.user_id}` },
          body: JSON.stringify({
            from: mailFrom,
            to: [to],
            subject: n.title,
            text: `${n.body}\n\nOpen the workspace: ${appUrl}#/notifications`,
            html: `<p>${esc(n.body)}</p><p><a href="${esc(appUrl)}#/notifications">Open the workspace</a></p>`
          })
        })
        if (res.ok) { await finish(n.id, 'email_status', 'sent'); out.email.sent++ }
        else { await finish(n.id, 'email_status', 'failed', `HTTP ${res.status}`); out.email.failed++ }
      } catch (e: any) {
        await finish(n.id, 'email_status', 'failed', String(e?.message ?? e))
        out.email.failed++
      }
    }
  }
  return json({ ok: true, ...out })
})
