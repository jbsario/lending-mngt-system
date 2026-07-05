import { createContext, useContext, useEffect, useState } from 'react'
import { pb } from './pocketbaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(pb.authStore.isValid ? pb.authStore.model : null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((_token, model) => {
      setSession(pb.authStore.isValid ? model : null)
    })
    return () => unsubscribe()
  }, [])

  async function signIn(email, password) {
    try {
      await pb.collection('users').authWithPassword(email, password)
      return { error: null }
    } catch (err) {
      return { error: { message: err?.message || 'Sign in failed. Check your email and password.' } }
    }
  }

  function signOut() {
    pb.authStore.clear()
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
