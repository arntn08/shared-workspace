import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { applyPrefs, defaultPrefs, loadPrefs, savePrefs } from '../lib/prefs'
import type { Prefs } from '../types'

const sizes = [
  { l: 'Small', v: 0.9 },
  { l: 'Normal', v: 1 },
  { l: 'Large', v: 1.2 },
  { l: 'Extra large', v: 1.4 }
]

export default function Settings() {
  const { profile, signOut } = useAuth()
  const [p, setP] = useState<Prefs>(defaultPrefs)

  useEffect(() => {
    if (profile) loadPrefs(profile.id).then(setP)
  }, [profile?.id])

  async function update(next: Prefs) {
    setP(next)
    applyPrefs(next)
    await savePrefs(profile!.id, next)
  }

  return (
    <>
      <h1>Settings</h1>
      <div className="card">
        <h2>Text size</h2>
        <div className="row">
          {sizes.map((s) => (
            <button key={s.v} className={p.text_scale === s.v ? 'primary' : ''} onClick={() => update({ ...p, text_scale: s.v })}>
              {s.l}
            </button>
          ))}
        </div>
        <label htmlFor="th">Theme</label>
        <select id="th" value={p.theme} onChange={(e) => update({ ...p, theme: e.target.value as Prefs['theme'] })}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <label htmlFor="ct">Contrast</label>
        <select id="ct" value={p.contrast} onChange={(e) => update({ ...p, contrast: e.target.value as Prefs['contrast'] })}>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </div>
      <div className="card">
        <h2>About access</h2>
        <p className="muted">
          Files here are view-only and shown only to the people they are assigned to. No website can fully prevent screenshots or copying, so treat anything on screen as visible to the person viewing it. Access is logged.
        </p>
      </div>
      <button onClick={signOut}>Sign out</button>
    </>
  )
}
