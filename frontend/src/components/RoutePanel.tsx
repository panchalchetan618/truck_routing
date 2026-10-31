import type { Route, TripPlan } from '../lib/api'
import { formatDuration, formatTime } from '../lib/format'
import { CAUSES, LEVELS } from '../lib/risk'
import LevelBadge from './LevelBadge'

function RiskBar({ route }: { route: Route }) {
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
      {LEVELS.map(({ key, label, color }) => (
        <div
          key={key}
          title={`${label}: ${route.miles_by_level[key]} mi`}
          style={{ width: `${(route.miles_by_level[key] / route.distance_miles) * 100}%`, backgroundColor: color }}
        />
      ))}
    </div>
  )
}

function RouteCard({
  route,
  index,
  selected,
  recommended,
  onSelect,
}: {
  route: Route
  index: number
  selected: boolean
  recommended: boolean
  onSelect: () => void
}) {
  const rest = route.duration_seconds - route.drive_seconds
  const riskyMiles = LEVELS.filter(({ key }) => route.miles_by_level[key] > 0 && key !== 'low')

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-left transition ${
        selected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">Route {index + 1}</span>
        <span className="flex items-center gap-2">
          {recommended && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Recommended</span>
          )}
          <LevelBadge level={route.worst_level} />
        </span>
      </div>
      <div className="mb-2 grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-xs text-slate-500">Distance</div>
          {Math.round(route.distance_miles).toLocaleString()} mi
        </div>
        <div>
          <div className="text-xs text-slate-500">Travel time</div>
          {formatDuration(route.duration_seconds)}
        </div>
        <div>
          <div className="text-xs text-slate-500">Avg risk</div>
          {route.average_risk.toFixed(2)} / 4
        </div>
      </div>
      <RiskBar route={route} />
      <div className="mt-2 text-xs text-slate-600">
        {riskyMiles.length
          ? riskyMiles.map(({ key, label }) => `${label} ${route.miles_by_level[key]} mi`).join(' · ')
          : 'Clear conditions along the whole route'}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Arrives {formatTime(route.arrival)}
        {rest > 0 && ` · includes ${formatDuration(rest)} mandatory rest`}
      </div>
    </button>
  )
}

function CheckpointTable({ route }: { route: Route }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">
        Checkpoints <span className="font-normal text-slate-500">(every {route.sampling_miles} mi, weather at ETA)</span>
      </h3>
      <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1.5">Mile</th>
              <th className="px-2 py-1.5">ETA</th>
              <th className="px-2 py-1.5">Wind</th>
              <th className="px-2 py-1.5">Rain</th>
              <th className="px-2 py-1.5">Snow</th>
              <th className="px-2 py-1.5">Risk</th>
            </tr>
          </thead>
          <tbody>
            {route.checkpoints.map((c) => (
              <tr key={c.mile} className="border-t border-slate-100">
                <td className="px-2 py-1">{c.mile}</td>
                <td className="px-2 py-1 whitespace-nowrap">{formatTime(c.eta)}</td>
                <td className="px-2 py-1">{c.weather.wind_mph} mph</td>
                <td className="px-2 py-1">{c.weather.rain_in_hr} in/h</td>
                <td className="px-2 py-1">{c.weather.snow_in_hr} in/h</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <LevelBadge level={c.level} />
                  {c.cause && <span className="ml-1 text-slate-500">{CAUSES[c.cause]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function RoutePanel({
  plan,
  selected,
  onSelect,
}: {
  plan: TripPlan
  selected: number
  onSelect: (index: number) => void
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-green-50 p-3 text-sm text-green-900">
        <span className="font-semibold">Route 1 is recommended</span> — {plan.recommendation_reason.toLowerCase()}.
      </div>
      {plan.routes.map((route, index) => (
        <RouteCard
          key={route.id}
          route={route}
          index={index}
          selected={index === selected}
          recommended={route.id === plan.recommended_route_id}
          onSelect={() => onSelect(index)}
        />
      ))}
      <CheckpointTable route={plan.routes[selected]} />
    </div>
  )
}
