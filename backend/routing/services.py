from bisect import bisect_right
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from itertools import accumulate

import requests
from django.conf import settings
from django.core.cache import cache
from rest_framework.exceptions import NotFound

from core.responses import UpstreamError

from .risk import Weather

METERS_PER_MILE = 1609.344
ROUTE_COUNT = 3
DETOUR_FRACTIONS = ((0.2, -0.2), (0.4, -0.4))
MAX_DETOUR_RATIO = 1.5
MAX_OVERLAP = 0.85
FORECAST_DAYS = 14
FORECAST_BATCH = 50
FORECAST_TTL = 30 * 60
GEOCODE_TTL = 24 * 60 * 60
NORTH_AMERICA_BBOX = "-170,15,-50,72"

http = requests.Session()
http.headers["User-Agent"] = "weather-aware-truck-routing/1.0"


@dataclass
class Route:
    coords: list
    cum_miles: list
    cum_seconds: list

    @property
    def miles(self):
        return self.cum_miles[-1]

    def locate(self, mile):
        i = min(max(bisect_right(self.cum_miles, mile) - 1, 0), len(self.coords) - 2)
        span = self.cum_miles[i + 1] - self.cum_miles[i]
        t = (mile - self.cum_miles[i]) / span if span else 0
        (lat1, lng1), (lat2, lng2) = self.coords[i], self.coords[i + 1]
        seconds = self.cum_seconds[i] + t * (self.cum_seconds[i + 1] - self.cum_seconds[i])
        return lat1 + t * (lat2 - lat1), lng1 + t * (lng2 - lng1), seconds


@dataclass
class Forecast:
    start: int
    wind: list
    rain: list
    snow: list

    def at(self, moment):
        i = round((moment.timestamp() - self.start) / 3600)
        i = min(max(i, 0), len(self.wind) - 1)
        return Weather(self.wind[i], self.rain[i], self.snow[i])


def _get_json(url, **params):
    try:
        response = http.get(url, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError) as exc:
        raise UpstreamError(f"Upstream request to {url.split('/')[2]} failed") from exc


def _parse_route(osrm_route):
    segments = [
        pair
        for leg in osrm_route["legs"]
        for pair in zip(leg["annotation"]["distance"], leg["annotation"]["duration"])
    ]
    return Route(
        coords=[(lat, lng) for lng, lat in osrm_route["geometry"]["coordinates"]],
        cum_miles=list(accumulate((m / METERS_PER_MILE for m, _ in segments), initial=0)),
        cum_seconds=list(accumulate((s for _, s in segments), initial=0)),
    )


def _osrm(points):
    path = ";".join(f"{lng},{lat}" for lat, lng in points)
    data = _get_json(
        f"{settings.OSRM_URL}/route/v1/driving/{path}",
        alternatives=ROUTE_COUNT if len(points) == 2 else "false",
        overview="full",
        geometries="geojson",
        annotations="distance,duration",
    )
    if data.get("code") == "NoRoute":
        raise NotFound("No drivable route found between these locations")
    if data.get("code") != "Ok":
        raise UpstreamError("Routing service returned an unexpected response")
    return [_parse_route(r) for r in data["routes"]]


def _detour_point(origin, destination, fraction):
    (lat1, lng1), (lat2, lng2) = origin, destination
    return (lat1 + lat2) / 2 - fraction * (lng2 - lng1), (lng1 + lng2) / 2 + fraction * (lat2 - lat1)


def _try_detour(origin, destination, fraction):
    try:
        return _osrm([origin, _detour_point(origin, destination, fraction), destination])[0]
    except (NotFound, UpstreamError):
        return None


def _cells(route):
    return {(round(lat, 2), round(lng, 2)) for lat, lng in route.coords}


def _overlap(a, b):
    cells = _cells(a)
    return len(cells & _cells(b)) / len(cells)


def fetch_routes(origin, destination):
    routes = _osrm([origin, destination])
    for fractions in DETOUR_FRACTIONS:
        if len(routes) >= ROUTE_COUNT:
            break
        with ThreadPoolExecutor() as pool:
            candidates = list(pool.map(lambda f: _try_detour(origin, destination, f), fractions))
        for candidate in filter(None, candidates):
            is_reasonable = candidate.miles <= routes[0].miles * MAX_DETOUR_RATIO
            is_distinct = all(_overlap(candidate, route) < MAX_OVERLAP for route in routes)
            if len(routes) < ROUTE_COUNT and is_reasonable and is_distinct:
                routes.append(candidate)
    return routes


def _forecast_key(lat, lng):
    return f"forecast:{lat}:{lng}"


def _fetch_forecast_batch(keys):
    data = _get_json(
        settings.OPEN_METEO_URL,
        latitude=",".join(str(lat) for lat, _ in keys),
        longitude=",".join(str(lng) for _, lng in keys),
        hourly="wind_speed_10m,rain,showers,snowfall",
        wind_speed_unit="mph",
        precipitation_unit="inch",
        timeformat="unixtime",
        timezone="GMT",
        forecast_days=FORECAST_DAYS,
    )
    hourly = [item["hourly"] for item in (data if isinstance(data, list) else [data])]
    return [
        Forecast(
            start=h["time"][0],
            wind=[w or 0 for w in h["wind_speed_10m"]],
            rain=[(r or 0) + (s or 0) for r, s in zip(h["rain"], h["showers"])],
            snow=[s or 0 for s in h["snowfall"]],
        )
        for h in hourly
    ]


def fetch_forecasts(points):
    keys = sorted({(round(lat, 2), round(lng, 2)) for lat, lng in points})
    forecasts = {}
    for key in keys:
        cached = cache.get(_forecast_key(*key))
        if cached:
            forecasts[key] = cached
    missing = [key for key in keys if key not in forecasts]
    batches = [missing[i : i + FORECAST_BATCH] for i in range(0, len(missing), FORECAST_BATCH)]
    with ThreadPoolExecutor() as pool:
        results = list(pool.map(_fetch_forecast_batch, batches))
    for batch, fetched in zip(batches, results):
        for key, forecast in zip(batch, fetched):
            forecasts[key] = forecast
            cache.set(_forecast_key(*key), forecast, FORECAST_TTL)
    return forecasts


def geocode(query):
    cache_key = f"geocode:{query.strip().lower()}"
    places = cache.get(cache_key)
    if places is None:
        data = _get_json(settings.PHOTON_URL, q=query, limit=6, lang="en", bbox=NORTH_AMERICA_BBOX)
        places = [
            {
                "label": ", ".join(dict.fromkeys(filter(None, (p.get(k) for k in ("name", "city", "state", "country"))))),
                "lat": f["geometry"]["coordinates"][1],
                "lng": f["geometry"]["coordinates"][0],
            }
            for f in data["features"]
            for p in [f["properties"]]
        ]
        cache.set(cache_key, places, GEOCODE_TTL)
    return places
