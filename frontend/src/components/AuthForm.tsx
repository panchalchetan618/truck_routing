import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { login, register, type AuthResult } from '../lib/api'

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function AuthForm({ onSignedIn }: { onSignedIn: (auth: AuthResult) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const auth = useMutation({
    mutationFn: mode === 'login' ? login : register,
    onSuccess: onSignedIn,
  })

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault()
          auth.mutate({ email, password })
        }}
      >
        <header>
          <h1 className="text-lg font-bold">Weather-Aware Truck Routing</h1>
          <p className="text-sm text-slate-500">
            {mode === 'login' ? 'Log in to plan routes and see your history.' : 'Create an account to save your route checks.'}
          </p>
        </header>
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            required
            minLength={mode === 'register' ? 8 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {auth.error && (
          <div role="alert" className="whitespace-pre-line rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {auth.error.message}
          </div>
        )}
        <button
          type="submit"
          disabled={auth.isPending}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300"
        >
          {auth.isPending ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <button
          type="button"
          className="w-full text-sm text-blue-700 hover:underline"
          onClick={() => {
            auth.reset()
            setMode(mode === 'login' ? 'register' : 'login')
          }}
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
        </button>
      </form>
    </div>
  )
}
