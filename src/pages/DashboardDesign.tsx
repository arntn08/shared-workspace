import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { logAction } from '../lib/audit'
import { DashSettings, defaultSettings, loadSettings, saveSettings } from '../lib/settings'

export default function DashboardDesign() {
  const { profile } = useAuth()
  const [s, setS] = useState<DashSettings>(defaultSettings)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadSettings().then(setS)
  }, [])

  async function save() {
    await saveSettings(s)
    await logAction(profile!.id, 'update_dashboard_design')
    setSaved(true)
  }
  const set = (patch: Partial<DashSettings>) => {
    setS({ ...s, ...patch })
    setSaved(false)
  }
  const cb = { width: 'auto', minHeight: 'auto' } as const

  return (
    <>
      <h1>Dashboard Design</h1>
      <p className="muted">Choose how the employee view looks and behaves.</p>
      <div className="card">
        <label htmlFor="title">Workspace name</label>
        <input id="title" value={s.title} onChange={(e) => set({ title: e.target.value })} />
        <label htmlFor="wl">Welcome line on the employee home screen</label>
        <input id="wl" value={s.welcome} onChange={(e) => set({ welcome: e.target.value })} />
        <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" style={cb} checked={s.group_by_month} onChange={(e) => set({ group_by_month: e.target.checked })} />
          Group files by month label
        </label>
        <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" style={cb} checked={s.show_search} onChange={(e) => set({ show_search: e.target.checked })} />
          Show the search box
        </label>
        <button className="primary" style={{ marginTop: '1rem' }} onClick={save}>Save</button>
        {saved && <span className="muted"> Saved.</span>}
      </div>
    </>
  )
}
