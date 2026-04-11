import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || ''
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient(url, key)

// Auth helpers
export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { data, error }
}
export const signUp = async (email, password) => {
  const { data, error } = await supabase.auth.signUp({ email, password })
  return { data, error }
}
export const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  return { error }
}
export const getSession = async () => {
  const { data } = await supabase.auth.getSession()
  return data.session
}

// BSALE API helper (calls through Supabase Edge Function or direct)
export const bsaleApi = async (endpoint, token) => {
  try {
    const r = await fetch(`https://api.bsale.cl/v1/${endpoint}`, {
      headers: { 'access_token': token, 'Content-Type': 'application/json' }
    })
    return await r.json()
  } catch (e) {
    console.error('BSALE API error:', e)
    return null
  }
}
