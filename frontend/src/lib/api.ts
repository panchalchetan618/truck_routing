import type { LevelKey } from './risk'

export interface Place {
  label: string
  lat: number
  lng: number
}

export interface Checkpoint {
  mile: number
  lat: number
  lng: number
  eta: string
  weather: { wind_mph: number; rain_in_hr: number; snow_in_hr: number }
  level: number
  label: LevelKey
  cause: 'wind_mph' | 'rain_in_hr' | 'snow_in_hr' | null
  hourly_levels: number[]
}

export interface Route {
  id: number
  distance_miles: number
  drive_seconds: number
  duration_seconds: number
  arrival: string
  sampling_miles: number
  miles_by_level: Record<LevelKey, number>
  average_risk: number
  worst_level: number
  geometry: [number, number][]
  checkpoints: Checkpoint[]
}

export interface TripPlan {
  departure: string
  load_weight_lb: number
  forecast_hours: number
  recommended_route_id: number
  recommendation_reason: string
  routes: Route[]
}

export interface User {
  id: number
  email: string
}

export interface AuthResult {
  token: string
  user: User
}

export interface HistoryItem {
  id: number
  origin: Place
  destination: Place
  departure: string
  load_weight_lb: number
  created_at: string
  summary: {
    distance_miles: number
    duration_seconds: number
    worst_level: number
    route_count: number
    reason: string
  }
}

export interface HistoryDetail extends HistoryItem {
  result: TripPlan
}

export interface TripRequest {
  origin: Place
  destination: Place
  departure: string
  load_weight_lb: number
}

interface Envelope<T> {
  success: boolean
  message: string
  data?: T
  errors?: unknown
}

const BASE_URL = import.meta.env.VITE_API_URL ?? ''
const TOKEN_KEY = 'token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

let onUnauthorized = () => {}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

function flattenErrors(errors: unknown, key = ''): string[] {
  if (typeof errors === 'string') return [key ? `${key}: ${errors}` : errors]
  if (Array.isArray(errors)) return errors.flatMap((e) => flattenErrors(e, key))
  if (errors && typeof errors === 'object') {
    return Object.entries(errors).flatMap(([k, v]) => flattenErrors(v, k))
  }
  return []
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const response = await fetch(BASE_URL + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Token ${token}` }) },
  })
  const body: Envelope<T> | null = await response.json().catch(() => null)
  if (response.status === 401 && token) {
    setToken(null)
    onUnauthorized()
  }
  if (!response.ok || !body?.success) {
    const details = flattenErrors(body?.errors)
    throw new Error(details.length ? details.join('\n') : (body?.message ?? 'Request failed'))
  }
  return body.data as T
}

export const searchPlaces = (query: string) =>
  request<Place[]>(`/api/geocode/?q=${encodeURIComponent(query)}`)

export const planTrip = (trip: TripRequest) =>
  request<TripPlan>('/api/trips/plan/', { method: 'POST', body: JSON.stringify(trip) })

export interface Credentials {
  email: string
  password: string
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const login = (credentials: Credentials) => request<AuthResult>('/api/auth/login/', post(credentials))

export const register = (credentials: Credentials) => request<AuthResult>('/api/auth/register/', post(credentials))

export const logout = () => request<void>('/api/auth/logout/', { method: 'POST' })

export const getMe = () => request<User>('/api/auth/me/')

export const getHistory = () => request<HistoryItem[]>('/api/trips/history/')

export const getHistoryItem = (id: number) => request<HistoryDetail>(`/api/trips/history/${id}/`)

export const deleteHistoryItem = (id: number) => request<void>(`/api/trips/history/${id}/`, { method: 'DELETE' })
