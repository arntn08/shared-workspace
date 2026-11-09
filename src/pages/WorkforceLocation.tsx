import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { fetchWorkforceLocations, localConsent, queuePosition, queuedPositions, saveLocalConsent, syncLocationQueue, type WorkforceLocationRow } from '../lib/workforceLocation'

const panel: React.CSSProperties = { background: 'var(--card, #fff)', border: '1px solid var(--border, #dfe7e1)', borderRadius: 18, padding: 18 }
const fmt = (value: string | null) => value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'No location received'
const age = (value: string | null) => {
  if (!value) return 'No update yet'
  const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return mins + ' min ago'
  if (mins < 1440) return Math.floor(mins / 60) + ' hr ago'
  return Math.floor(mins / 1440) + ' days ago'
}
const isRecent = (value: string | null) => !!value && Date.now() - new Date(value).getTime() < 3 * 60 * 1000

export function EmployeeLocationSharing() {
  const { profile } = useAuth()
  const uid = profile?.id
  const [enabled, setEnabled] = useState(false)
  const [consentedAt, setConsentedAt] = useState<string | null>(null)
  const [permission, setPermission] = useState('Not requested')
  const [pending, setPending] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!uid) return
    const saved = localConsent(uid)
    setEnabled(saved.enabled); setConsentedAt(saved.consentedAt); setPending(queuedPositions(uid).length)
    if (navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' as PermissionName }).then(p => setPermission(p.state)).catch(() => {})
    if (navigator.onLine) {
      supabase.from('workforce_locations').select('sharing_enabled,consented_at').eq('user_id', uid).maybeSingle().then(({ data }) => {
        if (data) {
          setEnabled(!!data.sharing_enabled)
          setConsentedAt(data.consented_at)
          saveLocalConsent(uid, !!data.sharing_enabled, data.consented_at)
        }
      })
    }
  }, [uid])

  const sync = useCallback(async () => {
    if (!uid || !navigator.onLine) return
    const result = await syncLocationQueue(uid)
    setPending(result.pending)
    if (result.error) setMessage('Sync will retry: ' + result.error)
    else if (result.synced) setMessage(result.synced + ' offline GPS update(s) synchronized.')
  }, [uid])

  useEffect(() => {
    if (!uid || !enabled) return
    const onOnline = () => void sync()
    window.addEventListener('online', onOnline)
    const timer = window.setInterval(() => void sync(), 30000)
    void sync()
    return () => { window.removeEventListener('online', onOnline); window.clearInterval(timer) }
  }, [uid, enabled, sync])

  useEffect(() => {
    if (!uid || !enabled || !navigator.geolocation) return
    const watch = navigator.geolocation.watchPosition(position => {
      const count = queuePosition(uid, position)
      setPending(count)
      setPermission('granted')
      if (navigator.onLine) void sync()
    }, error => {
      setPermission(error.code === 1 ? 'denied' : 'unavailable')
      setMessage(error.code === 1 ? 'Location permission is denied. Enable it in your device settings to share location.' : 'GPS is temporarily unavailable. The app will keep trying while sharing is enabled.')
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 })
    return () => navigator.geolocation.clearWatch(watch)
  }, [uid, enabled, sync])

  async function toggleSharing(next: boolean) {
    if (!uid) return
    setBusy(true); setMessage('')
    if (next) {
      if (!navigator.geolocation) { setMessage('This browser does not support GPS location.'); setBusy(false); return }
      const consent = window.confirm('Enable workforce location sharing? While Shared Workspace is open, the app will collect your device location and share it with authorized AHBA Owner, Editor and HR accounts. Offline updates stay on this device until internet returns. You can turn this off anytime.')
      if (!consent) { setBusy(false); return }
      const stamp = new Date().toISOString()
      saveLocalConsent(uid, true, stamp)
      setEnabled(true); setConsentedAt(stamp)
      try {
        await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 }))
        setPermission('granted')
        await syncLocationQueue(uid)
        setMessage(navigator.onLine ? 'Location sharing is enabled on this device.' : 'Enabled offline. Your location will sync when internet returns.')
      } catch (error) {
        const geo = error as GeolocationPositionError
        setPermission(geo.code === 1 ? 'denied' : 'unavailable')
        setMessage(geo.code === 1 ? 'Location permission was denied. You can enable it in device settings.' : 'Sharing is enabled, but GPS is not available yet.')
      }
    } else {
      saveLocalConsent(uid, false, consentedAt)
      setEnabled(false)
      setPending(0)
      localStorage.removeItem('ahba-location-queue:' + uid)
      if (navigator.onLine) {
        const { error } = await supabase.from('workforce_locations').upsert({
          user_id: uid, sharing_enabled: false, consented_at: consentedAt,
          last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })
        if (error) setMessage('Sharing is off on this device. Server status will update when internet returns.')
        else { localStorage.removeItem('ahba-location-pending:' + uid); setMessage('Location sharing has been turned off.') }
      } else setMessage('Sharing is off. The change will sync when internet returns.')
    }
    setBusy(false)
  }

  return <section style={{ display: 'grid', gap: 16, maxWidth: 850 }}>
    <header><span className="ops-eyebrow">PRIVACY & DEVICE LOCATION</span><h1>Location sharing</h1><p className="muted">You control whether your location is shared with authorized AHBA management.</p></header>
    <article style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div><strong style={{ fontSize: 18 }}>Share my location</strong><p className="muted" style={{ margin: '5px 0' }}>Only while Shared Workspace is open</p></div>
        <button className={enabled ? 'btn' : 'btn primary'} disabled={busy} onClick={() => void toggleSharing(!enabled)}>{busy ? 'Please wait…' : enabled ? 'Turn sharing off' : 'Enable sharing'}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 18 }}>
        <div><small className="muted">Sharing status</small><strong style={{ display: 'block' }}>{enabled ? 'Enabled' : 'Off'}</strong></div>
        <div><small className="muted">GPS permission</small><strong style={{ display: 'block' }}>{permission}</strong></div>
        <div><small className="muted">Offline updates queued</small><strong style={{ display: 'block' }}>{pending}</strong></div>
        <div><small className="muted">Consent recorded</small><strong style={{ display: 'block' }}>{consentedAt ? fmt(consentedAt) : 'Not yet'}</strong></div>
      </div>
    </article>
    <article style={panel}><strong>What management can see</strong><ul className="muted"><li>Your latest GPS coordinates and accuracy estimate.</li><li>When that location was captured and last synchronized.</li><li>Whether sharing is enabled.</li></ul><p className="muted">GPS is recorded only after you opt in. The app does not promise background tracking when closed or locked. If you lose internet, records are kept on this device and uploaded after reconnection.</p></article>
    {message && <div className="notice">{message}</div>}
  </section>
}

export function WorkforceMap() {
  const [rows, setRows] = useState<WorkforceLocationRow[]>([])
  const [profiles, setProfiles] = useState<Record<string, { full_name: string | null; email: string; teams: string[] | null }>>({})
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const [locations, people] = await Promise.all([
        fetchWorkforceLocations(),
        supabase.from('profiles').select('id,full_name,email,teams').eq('active', true).order('full_name')
      ])
      setRows(locations)
      const map: Record<string, { full_name: string | null; email: string; teams: string[] | null }> = {}
      ;(people.data || []).forEach(p => { map[p.id] = p })
      setProfiles(map); setError('')
      if (!selected && locations.length) setSelected(locations[0].user_id)
    } catch (e) { setError((e as Error).message || 'Unable to load workforce locations.') }
    finally { setLoading(false) }
  }, [selected])
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 30000); return () => window.clearInterval(id) }, [load])
  const visible = useMemo(() => rows.filter(r => r.sharing_enabled && r.latitude != null && r.longitude != null), [rows])
  const active = rows.filter(r => r.sharing_enabled)
  const chosen = visible.find(r => r.user_id === selected) || visible[0]
  const person = chosen ? profiles[chosen.user_id] : undefined
  const mapUrl = chosen ? `https://www.openstreetmap.org/export/embed.html?bbox=${chosen.longitude! - 0.02}%2C${chosen.latitude! - 0.02}%2C${chosen.longitude! + 0.02}%2C${chosen.latitude! + 0.02}&layer=mapnik&marker=${chosen.latitude}%2C${chosen.longitude}` : ''
  return <section style={{ display: 'grid', gap: 16 }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 12, flexWrap: 'wrap' }}><div><span className="ops-eyebrow">AHBA PEOPLE OPERATIONS</span><h1>Live Workforce Map</h1><p className="muted">Locations shared by employees who have explicitly opted in.</p></div><button className="small" onClick={() => void load()}>↻ Refresh</button></header>
    <div className="grid cols-3"><article style={panel}><small className="muted">Sharing enabled</small><h2>{active.length}</h2></article><article style={panel}><small className="muted">With GPS location</small><h2>{visible.length}</h2></article><article style={panel}><small className="muted">No recent sync</small><h2>{active.filter(r => !isRecent(r.last_seen_at)).length}</h2></article></div>
    {error && <div className="notice error">{error}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, .8fr) minmax(0, 1.5fr)', gap: 14 }}>
      <article style={{ ...panel, maxHeight: 520, overflowY: 'auto' }}><strong>Employees sharing location</strong>
        {loading && <p className="muted">Loading locations…</p>}
        {!loading && rows.length === 0 && <p className="muted">No employee has enabled location sharing yet.</p>}
        {rows.map(r => { const p = profiles[r.user_id]; return <button key={r.user_id} onClick={() => setSelected(r.user_id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, marginTop: 8, borderRadius: 12, border: selected === r.user_id ? '2px solid #24845a' : '1px solid var(--border, #ddd)', background: selected === r.user_id ? 'rgba(36,132,90,.08)' : 'transparent', color: 'inherit', cursor: 'pointer' }}><strong>{p?.full_name || p?.email || 'Workspace employee'}</strong><small className="muted" style={{ display: 'block' }}>{p?.teams?.join(', ') || 'No team listed'}</small><small style={{ display: 'block', marginTop: 4 }}>{r.sharing_enabled ? (isRecent(r.last_seen_at) ? '● Recently connected' : '○ No recent sync') : 'Sharing off'} · {age(r.last_seen_at)}</small></button> }) }
      </article>
      <article style={{ ...panel, minHeight: 390, padding: 8 }}><div style={{ padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{person?.full_name || person?.email || 'Select an employee'}</strong>{chosen && <a href={`https://www.openstreetmap.org/?mlat=${chosen.latitude}&mlon=${chosen.longitude}#map=16/${chosen.latitude}/${chosen.longitude}`} target="_blank" rel="noreferrer">Open full map ↗</a>}</div>
        {mapUrl ? <iframe title="Selected employee last known location" src={mapUrl} style={{ width: '100%', height: 340, border: 0, borderRadius: 12 }} loading="lazy" /> : <div style={{ minHeight: 340, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 20 }}><p className="muted">No GPS coordinates have been synchronized yet. The employee's location will appear after they enable sharing and the device sends its first update.</p></div>}
        {chosen && <div className="muted" style={{ padding: 10, fontSize: 13 }}>Last location captured: {fmt(chosen.captured_at)} · Last sync: {fmt(chosen.last_seen_at)}{chosen.accuracy_m != null ? ' · Accuracy ±' + Math.round(chosen.accuracy_m) + ' m' : ''}</div>}
      </article>
    </div>
    <p className="muted" style={{ fontSize: 12 }}>A stale location does not prove an employee is offline; it means the device has not synchronized recently. Background tracking is not guaranteed by installed PWAs. The map uses internet map tiles and may not render while this management device is offline.</p>
  </section>
}
