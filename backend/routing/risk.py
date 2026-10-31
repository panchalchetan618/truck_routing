from dataclasses import dataclass

LEVELS = ("low", "moderate", "high", "severe", "no_travel")
LOW, MODERATE, HIGH, SEVERE, NO_TRAVEL = range(len(LEVELS))

RULES = {
    "wind_mph": ((25, 35, 45, 55), False),
    "rain_in_hr": ((0.10, 0.25, 0.50, 1.00), True),
    "snow_in_hr": ((0.5, 1.0, 2.0, 3.0), True),
}

LOAD_WIND_RULES = (
    (45, 30_000, NO_TRAVEL),
    (35, 40_000, SEVERE),
)


@dataclass(frozen=True)
class Weather:
    wind_mph: float
    rain_in_hr: float
    snow_in_hr: float


def _level(value, limits, strict_top):
    reached_top = value > limits[3] if strict_top else value >= limits[3]
    if reached_top:
        return NO_TRAVEL
    return sum(value >= limit for limit in limits[:3])


def assess(weather, weight_lb):
    levels = {name: _level(getattr(weather, name), *rule) for name, rule in RULES.items()}
    for min_wind, min_weight, level in LOAD_WIND_RULES:
        if weather.wind_mph >= min_wind and weight_lb > min_weight:
            levels["wind_mph"] = max(levels["wind_mph"], level)
    cause = max(levels, key=levels.get)
    return levels[cause], cause if levels[cause] > LOW else None
