import math
from datetime import timedelta
from itertools import pairwise

from .risk import HIGH, LEVELS, NO_TRAVEL, SEVERE, assess
from .services import fetch_forecasts, fetch_routes

FORECAST_HOURS = 48
DRIVE_LIMIT_SECONDS = 11 * 3600
REST_SECONDS = 10 * 3600
SAMPLING_MILES = ((250, 10), (750, 25))
DEFAULT_SAMPLING_MILES = 50
SIMPLIFY_TOLERANCE = 0.0005

RANKING = (
    ("no_travel_miles", "Fewest No Travel miles"),
    ("severe_miles", "Fewest Severe miles"),
    ("high_miles", "Fewest High miles"),
    ("average_risk", "Lowest average risk"),
    ("duration_minutes", "Shortest travel time"),
)


def _elapsed_seconds(drive_seconds):
    rests = max(0, math.ceil(drive_seconds / DRIVE_LIMIT_SECONDS) - 1)
    return drive_seconds + rests * REST_SECONDS


def _sampling_miles(route_miles):
    return next((step for limit, step in SAMPLING_MILES if route_miles <= limit), DEFAULT_SAMPLING_MILES)


def _sample(route):
    step = _sampling_miles(route.miles)
    marks = [i * step for i in range(int(route.miles // step) + 1)]
    if marks[-1] < route.miles:
        marks.append(route.miles)
    edges = [0, *((a + b) / 2 for a, b in pairwise(marks)), route.miles]
    spans = [hi - lo for lo, hi in pairwise(edges)]
    samples = [(mark, span, *route.locate(mark)) for mark, span in zip(marks, spans)]
    return step, samples


def _simplify(points, tolerance=SIMPLIFY_TOLERANCE):
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        (ax, ay), (bx, by) = points[first], points[last]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1
        farthest, index = 0, None
        for i in range(first + 1, last):
            px, py = points[i]
            distance = abs(dy * (px - ax) - dx * (py - ay)) / norm
            if distance > farthest:
                farthest, index = distance, i
        if farthest > tolerance:
            keep.add(index)
            stack += [(first, index), (index, last)]
    return [points[i] for i in sorted(keep)]


def _analyze(route_id, route, step, samples, departure, weight_lb, forecasts):
    checkpoints = []
    miles_by_level = dict.fromkeys(LEVELS, 0.0)
    weighted_risk = 0.0
    for mile, span, lat, lng, raw_seconds in samples:
        eta = departure + timedelta(seconds=_elapsed_seconds(raw_seconds))
        forecast = forecasts[(round(lat, 2), round(lng, 2))]
        weather = forecast.at(eta)
        level, cause = assess(weather, weight_lb)
        hourly = [
            assess(forecast.at(departure + timedelta(hours=h)), weight_lb)[0]
            for h in range(FORECAST_HOURS + 1)
        ]
        miles_by_level[LEVELS[level]] += span
        weighted_risk += level * span
        checkpoints.append(
            {
                "mile": round(mile, 1),
                "lat": round(lat, 5),
                "lng": round(lng, 5),
                "eta": eta.isoformat(),
                "weather": {
                    "wind_mph": round(weather.wind_mph, 1),
                    "rain_in_hr": round(weather.rain_in_hr, 2),
                    "snow_in_hr": round(weather.snow_in_hr, 2),
                },
                "level": level,
                "label": LEVELS[level],
                "cause": cause,
                "hourly_levels": hourly,
            }
        )

    drive_seconds = route.cum_seconds[-1]
    duration_seconds = _elapsed_seconds(drive_seconds)
    return {
        "id": route_id,
        "distance_miles": round(route.miles, 1),
        "drive_seconds": round(drive_seconds),
        "duration_seconds": round(duration_seconds),
        "arrival": (departure + timedelta(seconds=duration_seconds)).isoformat(),
        "sampling_miles": step,
        "miles_by_level": {k: round(v, 1) for k, v in miles_by_level.items()},
        "average_risk": round(weighted_risk / route.miles, 2) if route.miles else 0,
        "worst_level": max(c["level"] for c in checkpoints),
        "geometry": _simplify([[round(lng, 5), round(lat, 5)] for lat, lng in route.coords]),
        "checkpoints": checkpoints,
    }


def _rank_key(route):
    miles = route["miles_by_level"]
    return (
        miles[LEVELS[NO_TRAVEL]],
        miles[LEVELS[SEVERE]],
        miles[LEVELS[HIGH]],
        route["average_risk"],
        route["duration_seconds"] // 60,
    )


def _reason(ranked):
    if len(ranked) == 1:
        return "Only route available"
    best, runner_up = (_rank_key(r) for r in ranked[:2])
    for (_, text), a, b in zip(RANKING, best, runner_up):
        if a < b:
            return text
    return "Equivalent to the alternatives"


def plan_trip(origin, destination, departure, weight_lb):
    routes = fetch_routes((origin["lat"], origin["lng"]), (destination["lat"], destination["lng"]))
    sampled = [_sample(route) for route in routes]
    forecasts = fetch_forecasts(
        [(lat, lng) for _, samples in sampled for *_, lat, lng, _ in samples]
    )
    analyses = [
        _analyze(i, route, step, samples, departure, weight_lb, forecasts)
        for i, (route, (step, samples)) in enumerate(zip(routes, sampled))
    ]
    ranked = sorted(analyses, key=_rank_key)
    return {
        "departure": departure.isoformat(),
        "load_weight_lb": weight_lb,
        "forecast_hours": FORECAST_HOURS,
        "recommended_route_id": ranked[0]["id"],
        "recommendation_reason": _reason(ranked),
        "routes": ranked,
    }
