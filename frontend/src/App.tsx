import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import AuthForm from './components/AuthForm'
import Dashboard from './components/Dashboard'
import { getToken, setToken, setUnauthorizedHandler, type AuthResult } from './lib/api'

export default function App() {
  const queryClient = useQueryClient()
  const [signedIn, setSignedIn] = useState(() => getToken() !== null)

  const signOut = () => {
    setToken(null)
    queryClient.clear()
    setSignedIn(false)
  }

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.clear()
      setSignedIn(false)
    })
  }, [queryClient])

  if (!signedIn) {
    return (
      <AuthForm
        onSignedIn={(auth: AuthResult) => {
          setToken(auth.token)
          setSignedIn(true)
        }}
      />
    )
  }
  return <Dashboard onSignedOut={signOut} />
}
