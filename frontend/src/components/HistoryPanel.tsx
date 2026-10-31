import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteHistoryItem, getHistory } from '../lib/api'
import { formatDuration, formatTime, shortPlace } from '../lib/format'
import LevelBadge from './LevelBadge'

export default function HistoryPanel({ onOpen, isOpening }: { onOpen: (id: number) => void; isOpening: boolean }) {
  const queryClient = useQueryClient()
  const history = useQuery({ queryKey: ['history'], queryFn: getHistory })
  const remove = useMutation({
    mutationFn: deleteHistoryItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['history'] }),
  })

  if (history.isPending) return <p className="text-sm text-slate-500">Loading history…</p>
  if (history.error) return <p className="text-sm text-red-700">{history.error.message}</p>
  if (!history.data.length) return <p className="text-sm text-slate-500">No route checks yet. Plan a trip and it will show up here.</p>

  return (
    <ul className="space-y-3">
      {history.data.map((item) => (
        <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-sm font-semibold" title={`${item.origin.label} → ${item.destination.label}`}>
              <span className="block truncate">
                {shortPlace(item.origin.label)} → {shortPlace(item.destination.label)}
              </span>
            </div>
            <LevelBadge level={item.summary.worst_level} />
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Checked {formatTime(item.created_at)} · departs {formatTime(item.departure)} · {item.load_weight_lb.toLocaleString()} lb
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Recommended: {Math.round(item.summary.distance_miles).toLocaleString()} mi ·{' '}
            {formatDuration(item.summary.duration_seconds)} · {item.summary.reason.toLowerCase()}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={isOpening}
              onClick={() => onOpen(item.id)}
              className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              View
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(item.id)}
              className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
