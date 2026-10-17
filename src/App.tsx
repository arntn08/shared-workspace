import { useEffect } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { isConfigured } from './lib/supabase'
import { applyPrefs, defaultPrefs, loadPrefs } from './lib/prefs'
import Login from './pages/Login'
import OwnerLayout from './components/OwnerLayout'
import EmployeeLayout from './components/EmployeeLayout'

function Gate() {
  const { session, profile, loading, signOut } = useAuth()

  useEffect(() => {
    if (profile) loadPrefs(profile.id).then(applyPrefs)
    else applyPrefs(defaultPrefs)
  }, [profile?.id])

  if (!isConfigured) {
    return (
      <div className="employee-shell">
        <div className="card">
          <h1>Almost there</h1>
          <p>The app is not connected to Supabase yet. Add the two build settings in GitHub, then redeploy.</p>
        </div>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="employee-shell">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (!session) return <Login />
  if (!profile || !profile.active) {
    return (
      <div className="employee-shell">
        <div className="card">
          <h1>No access</h1>
          <p>This account does not have access. Please contact the workspace owner.</p>
          <button onClick={signOut}>Sign out</button>
        </div>
      </div>
    )
  }
   return profile.role === 'owner' || profile.role === 'editor' ? <OwnerLayout /> : <EmployeeLayout />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
