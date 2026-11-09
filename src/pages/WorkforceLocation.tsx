import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
    else if (result.synced) setMessage('Latest GPS position synchronized; ' + result.synced + ' queued sample(s) processed.')
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

declare global {
  interface Window { L?: any }
}

let leafletLoader: Promise<any> | null = null
function loadLeaflet(): Promise<any> {
  if (window.L) return Promise.resolve(window.L)
  if (!leafletLoader) leafletLoader = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-ahba-leaflet]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.dataset.ahbaLeaflet = 'true'
      document.head.appendChild(link)
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-ahba-leaflet]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L))
      existing.addEventListener('error', () => reject(new Error('Map library could not be loaded.')))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.async = true
    script.dataset.ahbaLeaflet = 'true'
    script.onload = () => window.L ? resolve(window.L) : reject(new Error('Map library did not initialize.'))
    script.onerror = () => reject(new Error('Map library could not be loaded.'))
    document.head.appendChild(script)
  })
  return leafletLoader
}

function WorkforceLeafletMap({ locations, profiles, onSelect }: {
  locations: WorkforceLocationRow[]
  profiles: Record<string, { full_name: string | null; email: string; teams: string[] | null }>
  onSelect: (id: string) => void
}) {
  const element = useRef<HTMLDivElement | null>(null)
  const map = useRef<any>(null)
  const markers = useRef<any[]>([])
  const accuracyCircles = useRef<any[]>([])
  const [mapError, setMapError] = useState('')
  const [mapReady, setMapReady] = useState(false)
  useEffect(() => {
    let alive = true
    loadLeaflet().then(L => {
      if (!alive || !element.current) return
      const instance = L.map(element.current, { scrollWheelZoom: true }).setView([12.8797, 121.774], 5)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(instance)
      map.current = instance
      setMapReady(true)
    }).catch(error => { if (alive) setMapError(error.message || 'Map unavailable.') })
    return () => {
      alive = false
      if (map.current) { map.current.remove(); map.current = null }
    }
  }, [])
  useEffect(() => {
    const instance = map.current
    const L = window.L
    if (!instance || !L) return
    markers.current.forEach(marker => marker.remove())
    accuracyCircles.current.forEach(circle => circle.remove())
    markers.current = []
    accuracyCircles.current = []
    const points = locations.filter(row => row.latitude != null && row.longitude != null)
    points.forEach(row => {
      const person = profiles[row.user_id]
      const displayName = person?.full_name || person?.email || 'Employee'
      const initials = displayName.split(/\\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'AH'
      const fresh = isRecent(row.last_seen_at)
      const marker = L.marker([row.latitude, row.longitude], {
        icon: L.divIcon({
          className: 'ahba-workforce-pin',
          html: `<div style="width:42px;height:42px;border-radius:50% 50% 50% 8px;transform:rotate(-45deg);background:${fresh ? '#168653' : '#64748b'};border:3px solid white;box-shadow:0 3px 12px #0005;display:grid;place-items:center"><span style="transform:rotate(45deg);font:bold 12px system-ui;color:white">${initials}</span></div>`,
          iconSize: [42, 42],
          iconAnchor: [21, 38],
          popupAnchor: [0, -36]
        })
      }).addTo(instance)
      const safe = (value: string) => value.replace(/[<>&"]/g, '')
      const popup = `<div style="min-width:190px;font:13px system-ui"><strong style="font-size:15px">${safe(displayName)}</strong><div>${safe(person?.email || '')}</div><div style="margin:5px 0;color:${fresh ? '#168653' : '#64748b'}">${fresh ? '● Recently connected' : '○ No recent sync'}</div><div>Team: ${safe(person?.teams?.join(', ') || 'Not assigned')}</div><div>GPS accuracy: ${row.accuracy_m == null ? 'Not reported' : '±' + Math.round(row.accuracy_m) + ' m'}</div><div>Captured: ${safe(fmt(row.captured_at))}</div><div>Last sync: ${safe(fmt(row.last_seen_at))}</div><a href="https://www.google.com/maps?q=${row.latitude},${row.longitude}" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>`
      marker.bindPopup(popup)
      marker.on('click', () => onSelect(row.user_id))
      markers.current.push(marker)
      if (row.accuracy_m && row.accuracy_m > 0) {
        const circle = L.circle([row.latitude, row.longitude], {
          radius: Math.min(row.accuracy_m, 5000),
          color: fresh ? '#168653' : '#64748b',
          weight: 1,
          opacity: 0.55,
          fillOpacity: 0.08
        }).addTo(instance)
        accuracyCircles.current.push(circle)
      }
    })
    if (points.length === 1) instance.setView([points[0].latitude, points[0].longitude], 14)
    else if (points.length > 1) instance.fitBounds(L.latLngBounds(points.map(row => [row.latitude, row.longitude])), { padding: [28, 28], maxZoom: 14 })
  }, [locations, profiles, onSelect, mapReady])
  return <div style={{ position: 'relative' }}>
    <div ref={element} style={{ width: '100%', height: 420, borderRadius: 12, zIndex: 0, background: '#e8eee9' }} />
    {mapError && <div className="notice" style={{ marginTop: 8 }}>{mapError} Employee list and last-known timestamps are still available.</div>}
  </div>
}

export function WorkforceMap() {
  const [rows, setRows] = useState<WorkforceLocationRow[]>([])
  const [profiles, setProfiles] = useState<Record<string, { full_name: string | null; email: string; teams: string[] | null }>>({})
  const [selected, setSelected] = useState('')
  const selectLocation = useCallback((id: string) => setSelected(id), [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const [locations, people] = await Promise.all([
        fetchWorkforceLocations(),
        supabase.from('profiles').select('id,full_name,email,teams').eq('active', true).eq('role', 'employee').order('full_name')
      ])
      const roster = people.data || []
      const locationByUser = new Map(locations.map(row => [row.user_id, row]))
      const combined = roster.map(person => locationByUser.get(person.id) || ({
        user_id: person.id, sharing_enabled: false, consented_at: null, latitude: null,
        longitude: null, accuracy_m: null, captured_at: null, last_seen_at: null, updated_at: ''
      } as WorkforceLocationRow))
      setRows(combined)
      const map: Record<string, { full_name: string | null; email: string; teams: string[] | null }> = {}
      roster.forEach(p => { map[p.id] = p })
      setProfiles(map); setError('')
      if (!selected && combined.length) setSelected(combined[0].user_id)
    } catch (e) { setError((e as Error).message || 'Unable to load workforce locations.') }
    finally { setLoading(false) }
  }, [selected])
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 30000); return () => window.clearInterval(id) }, [load])
  const visible = useMemo(() => rows.filter(r => r.sharing_enabled && r.latitude != null && r.longitude != null), [rows])
  const active = rows.filter(r => r.sharing_enabled)
  const chosen = visible.find(r => r.user_id === selected) || visible[0]
  const person = chosen ? profiles[chosen.user_id] : undefined
  return <section style={{ display: 'grid', gap: 16 }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 12, flexWrap: 'wrap' }}><div><span className="ops-eyebrow">AHBA PEOPLE OPERATIONS</span><h1>Live Workforce Map</h1><p className="muted">Locations shared by employees who have explicitly opted in.</p></div><button className="small" onClick={() => void load()}>↻ Refresh</button></header>
    <div className="grid cols-3"><article style={panel}><small className="muted">Sharing enabled</small><h2>{active.length}</h2></article><article style={panel}><small className="muted">With GPS location</small><h2>{visible.length}</h2></article><article style={panel}><small className="muted">No recent sync</small><h2>{active.filter(r => !isRecent(r.last_seen_at)).length}</h2></article></div>
    {error && <div className="notice error">{error}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, .8fr) minmax(0, 1.5fr)', gap: 14 }}>
      <article style={{ ...panel, maxHeight: 520, overflowY: 'auto' }}><strong>Employee location-sharing status</strong>
        {loading && <p className="muted">Loading locations…</p>}
        {!loading && rows.length === 0 && <p className="muted">No active employee accounts were found.</p>}
        {rows.map(r => { const p = profiles[r.user_id]; return <button key={r.user_id} onClick={() => setSelected(r.user_id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, marginTop: 8, borderRadius: 12, border: selected === r.user_id ? '2px solid #24845a' : '1px solid var(--border, #ddd)', background: selected === r.user_id ? 'rgba(36,132,90,.08)' : 'transparent', color: 'inherit', cursor: 'pointer' }}><strong>{p?.full_name || p?.email || 'Workspace employee'}</strong><small className="muted" style={{ display: 'block' }}>{p?.teams?.join(', ') || 'No team listed'}</small><small style={{ display: 'block', marginTop: 4 }}>{r.sharing_enabled ? (isRecent(r.last_seen_at) ? '● Recently connected' : '○ No recent sync') : (r.last_seen_at ? 'Sharing off' : 'Not enabled')} · {age(r.last_seen_at)}</small></button> }) }
      </article>
      <article style={{ ...panel, minHeight: 390, padding: 8 }}><div style={{ padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{visible.length} employee location marker(s)</strong>{chosen && <a href={`https://www.google.com/maps?q=${chosen.latitude},${chosen.longitude}`} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>}</div>
        <WorkforceLeafletMap locations={visible} profiles={profiles} onSelect={selectLocation} />
        {chosen && <div style={{ padding: 14, margin: 8, border: '1px solid var(--border, #ddd)', borderRadius: 14, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div><strong style={{ fontSize: 17 }}>{person?.full_name || person?.email || 'Selected employee'}</strong><div className="muted" style={{ fontSize: 12 }}>{person?.email || 'No email available'}</div></div>
            <span className="badge">{isRecent(chosen.last_seen_at) ? 'Recently connected' : 'No recent sync'}</span>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>Department / team: {person?.teams?.join(', ') || 'Not assigned'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 10 }}>
            <div><small className="muted">GPS accuracy estimate</small><strong style={{ display: 'block' }}>{chosen.accuracy_m != null ? '±' + Math.round(chosen.accuracy_m) + ' meters' : 'Not reported'}</strong></div>
            <div><small className="muted">Location captured</small><strong style={{ display: 'block' }}>{age(chosen.captured_at)}</strong></div>
            <div><small className="muted">Last synchronized</small><strong style={{ display: 'block' }}>{age(chosen.last_seen_at)}</strong></div>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Coordinates: {chosen.latitude?.toFixed(6)}, {chosen.longitude?.toFixed(6)} · {fmt(chosen.captured_at)}</div>
        </div>}
      </article>
    </div>
    <p className="muted" style={{ fontSize: 12 }}>Pin initials identify the employee; the shaded circle represents the device-reported GPS accuracy radius. Accuracy is an estimate, not a guarantee. A stale location does not prove an employee is offline; it means the device has not synchronized recently. Background tracking is not guaranteed by installed PWAs. The map uses internet map tiles and may not render while this management device is offline.</p>
  </section>
}
