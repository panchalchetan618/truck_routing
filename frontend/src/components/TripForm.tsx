import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { searchPlaces, type Place, type TripRequest } from '../lib/api'
import { toLocalInputValue } from '../lib/format'

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200'

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function PlaceInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: Place | null
  onChange: (place: Place | null) => void
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const query = useDebounced(text.trim(), 300)
  const { data: places = [], isFetching } = useQuery({
    queryKey: ['places', query],
    queryFn: () => searchPlaces(query),
    enabled: open && !value && query.length >= 3,
    staleTime: Infinity,
  })

  const select = (place: Place) => {
    setText(place.label)
    setOpen(false)
    onChange(place)
  }

  return (
    <label className="relative block text-sm font-medium text-slate-700">
      {label}
      <input
        className={`${inputClass} mt-1 ${value ? 'border-green-500' : ''}`}
        value={text}
        placeholder="Start typing a city or address"
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          onChange(null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && !value && query.length >= 3 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {isFetching && <li className="px-3 py-2 text-slate-500">Searching…</li>}
          {!isFetching && !places.length && <li className="px-3 py-2 text-slate-500">No matches</li>}
          {places.map((place) => (
            <li
              key={`${place.lat},${place.lng}`}
              className="cursor-pointer px-3 py-2 font-normal hover:bg-blue-50"
              onMouseDown={() => select(place)}
            >
              {place.label}
            </li>
          ))}
        </ul>
      )}
    </label>
  )
}

function nextHour() {
  const date = new Date(Date.now() + 3600_000)
  date.setMinutes(0, 0, 0)
  return toLocalInputValue(date)
}

export default function TripForm({
  isPending,
  onSubmit,
}: {
  isPending: boolean
  onSubmit: (trip: TripRequest) => void
}) {
  const [origin, setOrigin] = useState<Place | null>(null)
  const [destination, setDestination] = useState<Place | null>(null)
  const [departure, setDeparture] = useState(nextHour)
  const [weight, setWeight] = useState('40000')

  const canSubmit = origin && destination && departure && weight !== '' && !isPending

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (origin && destination) {
          onSubmit({
            origin,
            destination,
            departure: new Date(departure).toISOString(),
            load_weight_lb: Number(weight),
          })
        }
      }}
    >
      <PlaceInput label="Origin" value={origin} onChange={setOrigin} />
      <PlaceInput label="Destination" value={destination} onChange={setDestination} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-slate-700">
          Departure
          <input
            type="datetime-local"
            className={`${inputClass} mt-1`}
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Load weight (lb)
          <input
            type="number"
            min={0}
            max={80000}
            step={500}
            className={`${inputClass} mt-1`}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isPending ? 'Analyzing routes and weather…' : 'Find safest route'}
      </button>
    </form>
  )
}
