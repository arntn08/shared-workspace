import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { disablePush, enablePush, pushSupported } from '../lib/push'

interface Prefs {
  cat_file_updates: boolean
  cat_reminders: boolean
  email_enabled: boolean
  push_enabled: boolean
}
const DEFAULTS: Prefs = { cat_file_updates: true, cat_reminders: true, email_enabled: true, push_enabled: false }
const line = { display: 'flex', gap: '0.6rem', alignItems: 'center', fontWeight: 400, margin: '0.5rem 0' } as const
const box = { width: 'auto', minHeight: 'auto' } as const

export default function NotificationPrefs() {
  const { profile } = useAuth()
  const [p, setP] = useState<Prefs>(DEFAULTS)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!profile) return
    supabase
      .from('notification_prefs')
      .select('cat_file_updates,cat_reminders,email_enabled,push_enabled')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => setP({ ...DEFAULTS, ...(data ?? {}) }))
  }, [profile?.id])

  async function save(next: Prefs) {
    setP(next)
    const { error } = await supabase
      .from('notification_prefs')
      .upsert({ user_id: profile!.id, ...next, updated_at: new Date().toISOString() })
    setMsg(error ? 'Could not save your choices.' : '')
  }

  async function togglePush(on: boolean) {
    setMsg('')
    if (on) {
      const err = await enablePush(profile!.id)
      if (err) return setMsg(err)
    } else {
      await disablePush(profile!.id)
    }
    save({ ...p, push_enabled: on })
  }

  const perm = pushSupported() ? Notification.permission : 'unsupported'

  return (
    <div className="card">
      <h2>Notifications</h2>
      <label style={line}>
        <input type="checkbox" style={box} checked={p.cat_file_updates} onChange={(e) => save({ ...p, cat_file_updates: e.target.checked })} />
        File updates
      </label>
      <label style={line}>
        <input type="checkbox" style={box} checked={p.cat_reminders} onChange={(e) => save({ ...p, cat_reminders: e.target.checked })} />
        Reminders
      </label>
      <label style={line}>
        <input type="checkbox" style={box} checked={p.email_enabled} onChange={(e) => save({ ...p, email_enabled: e.target.checked })} />
        Also email me
      </label>
      <label style={line}>
        <input type="checkbox" style={box} checked={p.push_enabled} disabled={perm === 'unsupported'} onChange={(e) => togglePush(e.target.checked)} />
        Push notifications on this device
      </label>
      <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
        {perm === 'unsupported'
          ? 'This browser cannot receive push. On iPhone, add the app to your Home Screen first.'
          : perm === 'denied'
            ? 'Notifications are blocked in your browser settings.'
            : 'Turned-off categories are not sent to you at all.'}
      </p>
      {msg && <p className="error" style={{ marginTop: '0.5rem' }}>{msg}</p>}
    </div>
  )
}
