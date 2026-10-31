import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { isConfigured, supabase } from './lib/supabase'
import { applyPrefs, defaultPrefs, loadPrefs } from './lib/prefs'
import Login from './pages/Login'
import OwnerLayout from './components/OwnerLayout'
import EmployeeLayout from './components/EmployeeLayout'
import HrLayout from './components/HrLayout'
import ARLayout from './components/ARLayout'
import TeamLeaderLayout from './components/TeamLeaderLayout'

function Gate() {
  const { session, profile, loading, signOut } = useAuth()
  const [teamLeader, setTeamLeader] = useState(false)
  const [leaderCheck, setLeaderCheck] = useState(false)

  useEffect(() => {
    if (profile) loadPrefs(profile.id).then(applyPrefs)
    else applyPrefs(defaultPrefs)
  }, [profile?.id])

  useEffect(() => {
    let live = true
    setTeamLeader(false)
    if (!profile || profile.role !== 'employee' || !profile.active) { setLeaderCheck(true); return }
    setLeaderCheck(false)
    supabase.from('sales_team_leaders').select('user_id').eq('user_id', profile.id).eq('active', true).maybeSingle().then(({ data }) => {
      if (live) { setTeamLeader(!!data); setLeaderCheck(true) }
    })
    return () => { live = false }
  }, [profile?.id, profile?.role, profile?.active])

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
  if (!leaderCheck) return <div className="employee-shell"><p className="muted">Checking account access…</p></div>
  return teamLeader ? <TeamLeaderLayout /> : profile.role === 'ar_encoder' ? <ARLayout /> : profile.role === 'owner' || profile.role === 'editor' ? <OwnerLayout /> : profile.role === 'hr' ? <HrLayout /> : <EmployeeLayout />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
