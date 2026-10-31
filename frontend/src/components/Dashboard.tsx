import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getHistoryItem, getMe, logout, planTrip, type TripPlan } from '../lib/api'
import { formatTime } from '../lib/format'
import HistoryPanel from './HistoryPanel'
import MapView from './MapView'
import RoutePanel from './RoutePanel'
import TripForm from './TripForm'

type Tab = 'plan' | 'history'

export default function Dashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('plan')
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)

  const show = (next: TripPlan, checkedAt: string | null) => {
    setPlan(next)
    setSavedAt(checkedAt)
    setSelected(0)
    setTab('plan')
  }

  const me = useQuery({ queryKey: ['me'], queryFn: getMe })
  const signOut = useMutation({ mutationFn: logout, onSettled: onSignedOut })
  const trip = useMutation({
    mutationFn: planTrip,
    onSuccess: (data) => {
      show(data, null)
      queryClient.invalidateQueries({ queryKey: ['history'] })
    },
  })
  const openSaved = useMutation({
    mutationFn: getHistoryItem,
    onSuccess: (item) => show(item.result, item.created_at),
  })

  const error = trip.error ?? openSaved.error
  const tabClass = (name: Tab) =>
    `flex-1 border-b-2 px-3 py-2 text-sm font-semibold ${
      tab === name ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
    }`

  return (
    <div className="flex h-dvh flex-col lg:flex-row">
      <aside className="max-h-[55dvh] w-full space-y-4 overflow-y-auto border-slate-200 bg-white p-4 lg:max-h-none lg:w-105 lg:shrink-0 lg:border-r">
        <header className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">Weather-Aware Truck Routing</h1>
            <p className="text-sm text-slate-500">{me.data?.email ?? 'Pick the safest route for your load.'}</p>
          </div>
          <button
            type="button"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Log out
          </button>
        </header>

        <nav className="flex border-b border-slate-200">
          <button type="button" className={tabClass('plan')} onClick={() => setTab('plan')}>
            New check
          </button>
          <button type="button" className={tabClass('history')} onClick={() => setTab('history')}>
            History
          </button>
        </nav>

        {error && (
          <div role="alert" className="whitespace-pre-line rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error.message}
          </div>
        )}

        <div className={tab === 'plan' ? 'space-y-4' : 'hidden'}>
          <TripForm isPending={trip.isPending} onSubmit={trip.mutate} />
          {savedAt && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Saved result from {formatTime(savedAt)}. Forecasts may have changed, so run a new check for fresh data.
            </div>
          )}
          {plan && <RoutePanel plan={plan} selected={selected} onSelect={setSelected} />}
        </div>

        <div className={tab === 'history' ? '' : 'hidden'}>
          <HistoryPanel onOpen={openSaved.mutate} isOpening={openSaved.isPending} />
        </div>
      </aside>
      <main className="min-h-0 flex-1">
        <MapView plan={plan} selected={selected} onSelect={setSelected} />
      </main>
    </div>
  )
}
