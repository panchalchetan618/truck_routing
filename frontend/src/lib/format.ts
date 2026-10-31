const pad = (n: number) => String(n).padStart(2, '0')

export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${pad(minutes % 60)}m` : `${minutes}m`
}

export function formatTime(value: string | number | Date) {
  return new Date(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function toLocalInputValue(date: Date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const shortPlace = (label: string) => label.split(',').slice(0, 2).join(',')
