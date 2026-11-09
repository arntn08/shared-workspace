import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { applyPrefs, loadPrefs, savePrefs } from '../lib/prefs'
import type { Prefs } from '../types'

const paths: Record<string, string> = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V11z',
  schedule: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 
  files: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  people: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21a8 8 0 0 1 16 0',
  design: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  teams: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M23 11h-6',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  tally: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  user: 'M20 21a8 8 0 0 0-16 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  // Navigation icons used by Owner, Editor, HR, AR Encoder and Employee tabs.
  receipt: 'M4 2l2 1 2-1 2 1 2-1 2 1 2-1 2 1v20l-2-1-2 1-2-1-2 1-2-1-2 1-2-1V2zM8 8h8M8 12h8M8 16h5',
  'file-text': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  calendar: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01',
  chart: 'M3 3v18h18M8 16V9M13 16V5M18 16v-4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8a4 4 0 0 1 0 7M20 21v-2a4 4 0 0 0-3-3.87',
  'users-round': 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8a3 3 0 1 1-2.5-2.96M20 21v-2a4 4 0 0 0-2.5-3.87',
  'calendar-check': 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 15l2.5 2.5L16 12',
}

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? 'M12 9v4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'} />
    </svg>
  )
}

export function initialsOf(name?: string | null, email?: string) {
  const src = (name && name.trim()) || (email ?? '').split('@')[0].replace(/[._-]+/g, ' ')
  const parts = src.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function Avatar({ name, email, large }: { name?: string | null; email?: string; large?: boolean }) {
  return (
    <span className={`avatar${large ? ' lg' : ''}`} title={name || email}>
      {initialsOf(name, email)}
    </span>
  )
}

export function ThemeButton() {
  const { profile } = useAuth()
  const [dark, setDark] = useState(document.documentElement.dataset.theme !== 'light')

  useEffect(() => {
    let alive = true
    if (!profile?.id) return
    loadPrefs(profile.id).then(prefs => {
      if (alive) setDark(prefs.theme === 'dark')
    })
    return () => { alive = false }
  }, [profile?.id])

  async function toggle() {
    if (!profile) return
    const p = await loadPrefs(profile.id)
    const next: Prefs = { ...p, theme: dark ? 'light' : 'dark' }
    applyPrefs(next)
    setDark(!dark)
    await savePrefs(profile.id, next)
  }

  return (
    <button className="icon-btn" onClick={toggle} title="Switch theme" aria-label="Switch theme">
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  )
}
