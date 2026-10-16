import { createClient } from '@supabase/supabase-js'

const url = 'https://vduphuzjmhcgrsxyrvzt.supabase.co'
const anonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkdXBodXpqbWhjZ3JzeHlydnp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzY1NTMsImV4cCI6MjEwNzcxMjU1M30.04kMRT3y3SyyIVqa4DLS7QC05iKLTT9HDy5ApYKhrOs'

export const isConfigured = true

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
})
