export const LEVELS = [
  { key: 'low', label: 'Low', color: '#16a34a', heat: 0.1 },
  { key: 'moderate', label: 'Moderate', color: '#eab308', heat: 0.3 },
  { key: 'high', label: 'High', color: '#f97316', heat: 0.5 },
  { key: 'severe', label: 'Severe', color: '#dc2626', heat: 0.7 },
  { key: 'no_travel', label: 'No Travel', color: '#6b21a8', heat: 0.95 },
] as const

export type LevelKey = (typeof LEVELS)[number]['key']

export const CAUSES = { wind_mph: 'wind', rain_in_hr: 'rain', snow_in_hr: 'snow' } as const
