import type { LngLatBoundsLike } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Layer,
  Map,
  Popup,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import type { TripPlan } from '../lib/api'
import { formatTime } from '../lib/format'
import { CAUSES, LEVELS } from '../lib/risk'
import LevelBadge from './LevelBadge'

const mapLib = import('maplibre-gl').then((maplibre) => {
  maplibre.setWorkerUrl(workerUrl)
  return maplibre
})

const BASEMAP = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

const levelColor = ['match', ['get', 'level'], ...LEVELS.flatMap((l, i) => [i, l.color]), '#64748b'] as never

const routeLayer: LayerProps = {
  id: 'routes',
  type: 'line',
  layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', ['get', 'selected'], 1, 0] },
  paint: {
    'line-color': ['case', ['get', 'selected'], '#2563eb', '#94a3b8'],
    'line-width': ['case', ['get', 'selected'], 6, 4],
    'line-opacity': ['case', ['get', 'selected'], 0.9, 0.7],
  },
}

const checkpointLayer: LayerProps = {
  id: 'checkpoints',
  type: 'circle',
  paint: {
    'circle-color': levelColor,
    'circle-radius': ['case', ['get', 'selected'], 6, 4],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1.5,
    'circle-opacity': ['case', ['get', 'selected'], 1, 0.75],
  },
}

const HEAT_RADIUS_PX_PER_MILE = 0.03
const HEAT_KERNEL_GAIN = 2.5

const heatLayer = (samplingMiles: number): LayerProps => {
  const radius = HEAT_RADIUS_PX_PER_MILE * samplingMiles
  return {
    id: 'heat',
    type: 'heatmap',
    paint: {
      'heatmap-weight': ['get', 'heat'],
      'heatmap-intensity': HEAT_KERNEL_GAIN,
      'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, radius, 8, radius * 2 ** 8],
      'heatmap-opacity': 0.7,
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(22,163,74,0)',
        ...LEVELS.flatMap((level) => [level.heat, level.color]),
      ],
    },
  }
}

type Popover = { route: number; checkpoint: number }

export default function MapView({
  plan,
  selected,
  onSelect,
}: {
  plan: TripPlan | null
  selected: number
  onSelect: (index: number) => void
}) {
  const mapRef = useRef<MapRef>(null)
  const [hour, setHour] = useState(0)
  const [popover, setPopover] = useState<Popover | null>(null)
  const [hovering, setHovering] = useState(false)
  const [shownPlan, setShownPlan] = useState(plan)
  if (plan !== shownPlan) {
    setShownPlan(plan)
    setPopover(null)
  }

  const routes = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (plan?.routes ?? []).map((route, index) => ({
        type: 'Feature' as const,
        properties: { index, selected: index === selected },
        geometry: { type: 'LineString' as const, coordinates: route.geometry },
      })),
    }),
    [plan, selected],
  )

  const checkpoints = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (plan?.routes ?? []).flatMap((route, routeIndex) =>
        route.checkpoints.map((c, index) => ({
          type: 'Feature' as const,
          properties: { route: routeIndex, index, level: c.level, selected: routeIndex === selected },
          geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
        })),
      ),
    }),
    [plan, selected],
  )

  const heat = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (plan?.routes[selected]?.checkpoints ?? []).map((c) => ({
        type: 'Feature' as const,
        properties: { heat: LEVELS[c.hourly_levels[hour]].heat },
        geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
      })),
    }),
    [plan, selected, hour],
  )

  useEffect(() => {
    if (!plan) return
    const points = plan.routes.flatMap((r) => r.geometry)
    const lngs = points.map(([lng]) => lng)
    const lats = points.map(([, lat]) => lat)
    const bounds: LngLatBoundsLike = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ]
    mapRef.current?.fitBounds(bounds, { padding: 70, duration: 800 })
  }, [plan])

  const handleClick = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    if (feature?.layer.id === 'checkpoints') {
      const { route, index } = feature.properties
      onSelect(route)
      setPopover({ route, checkpoint: index })
    } else if (feature?.layer.id === 'routes') {
      onSelect(feature.properties.index)
      setPopover(null)
    } else {
      setPopover(null)
    }
  }

  const active = popover && plan?.routes[popover.route]?.checkpoints[popover.checkpoint]
  const forecastTime = plan ? new Date(new Date(plan.departure).getTime() + hour * 3600_000) : null

  return (
    <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        mapLib={mapLib}
        mapStyle={BASEMAP}
        initialViewState={{ longitude: -96, latitude: 38.5, zoom: 3.6 }}
        interactiveLayerIds={['checkpoints', 'routes']}
        cursor={hovering ? 'pointer' : 'grab'}
        onClick={handleClick}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <Source id="heat" type="geojson" data={heat}>
          <Layer {...heatLayer(plan?.routes[selected]?.sampling_miles ?? 50)} />
        </Source>
        <Source id="routes" type="geojson" data={routes}>
          <Layer {...routeLayer} />
        </Source>
        <Source id="checkpoints" type="geojson" data={checkpoints}>
          <Layer {...checkpointLayer} />
        </Source>
        {active && popover && (
          <Popup
            longitude={active.lng}
            latitude={active.lat}
            closeOnClick={false}
            onClose={() => setPopover(null)}
            maxWidth="260px"
          >
            <div className="space-y-1 text-xs">
              <div className="font-semibold">
                Route {popover.route + 1} · mile {active.mile}
              </div>
              <div>ETA {formatTime(active.eta)}</div>
              <div>
                Wind {active.weather.wind_mph} mph · Rain {active.weather.rain_in_hr} in/h · Snow{' '}
                {active.weather.snow_in_hr} in/h
              </div>
              <div>
                <LevelBadge level={active.level} />
                {active.cause && <span className="ml-1 text-slate-500">driven by {CAUSES[active.cause]}</span>}
              </div>
            </div>
          </Popup>
        )}
      </Map>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
        <div className="pointer-events-auto w-full max-w-xl rounded-xl bg-white/95 p-3 shadow-lg backdrop-blur">
          {plan && forecastTime ? (
            <>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-semibold">Weather heatmap · +{hour}h</span>
                <span className="text-slate-600">{formatTime(forecastTime)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={plan.forecast_hours}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                aria-label="Forecast hour"
                className="w-full accent-blue-600"
              />
            </>
          ) : (
            <div className="text-center text-sm text-slate-500">Plan a trip to see routes and the weather heatmap</div>
          )}
          <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-slate-600">
            {LEVELS.map(({ key, label, color }) => (
              <span key={key} className="flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
