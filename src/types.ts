export type Role = 'owner' | 'editor' | 'employee' | 'hr' | 'ar_encoder'
export type FileKind = 'gsheet' | 'gdoc' | 'excel' | 'word' | 'other'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: Role
  active: boolean
  teams?: string[] 
  created_at: string
}

export interface FileRow {
  id: string
  title: string
  kind: FileKind
  url: string | null
  sheet_id: string | null
  month_label: string | null
  created_at: string
}

export interface Prefs {
  text_scale: number
  theme: 'light' | 'dark'
  contrast: 'normal' | 'high'
}
