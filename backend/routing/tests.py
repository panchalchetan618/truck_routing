from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from django.utils import timezone as dj_timezone
from django.contrib.auth.models import User
from rest_framework.test import APIClient, APISimpleTestCase, APITestCase

from . import planner
from .risk import HIGH, LOW, MODERATE, NO_TRAVEL, SEVERE, Weather, assess
from .services import Forecast, Route

LIGHT, HEAVY = 20_000, 45_000


class Forecasts(dict):
    def __init__(self, resolve):
        super().__init__()
        self.resolve = resolve

    def __missing__(self, key):
        return self.resolve(key)


def level(wind=0, rain=0, snow=0, weight=LIGHT):
    return assess(Weather(wind, rain, snow), weight)[0]


class RiskRulesTests(APISimpleTestCase):
    def test_wind_thresholds(self):
        cases = [(24.9, LOW), (25, MODERATE), (34.9, MODERATE), (35, HIGH), (44.9, HIGH), (45, SEVERE), (54.9, SEVERE), (55, NO_TRAVEL)]
        for wind, expected in cases:
            self.assertEqual(level(wind=wind), expected, wind)

    def test_rain_thresholds(self):
        cases = [(0.09, LOW), (0.10, MODERATE), (0.25, HIGH), (0.50, SEVERE), (1.00, SEVERE), (1.01, NO_TRAVEL)]
        for rain, expected in cases:
            self.assertEqual(level(rain=rain), expected, rain)

    def test_snow_thresholds(self):
        cases = [(0.4, LOW), (0.5, MODERATE), (1.0, HIGH), (2.0, SEVERE), (3.0, SEVERE), (3.1, NO_TRAVEL)]
        for snow, expected in cases:
            self.assertEqual(level(snow=snow), expected, snow)

    def test_heavy_load_escalates_wind(self):
        self.assertEqual(level(wind=40, weight=40_000), HIGH)
        self.assertEqual(level(wind=40, weight=40_001), SEVERE)
        self.assertEqual(level(wind=50, weight=30_000), SEVERE)
        self.assertEqual(level(wind=50, weight=30_001), NO_TRAVEL)
        self.assertEqual(level(wind=56, weight=0), NO_TRAVEL)

    def test_worst_condition_wins_and_is_reported(self):
        result = assess(Weather(26, 0.3, 0), LIGHT)
        self.assertEqual(result, (HIGH, "rain_in_hr"))
        self.assertEqual(assess(Weather(0, 0, 0), LIGHT), (LOW, None))


class RouteGeometryTests(APISimpleTestCase):
    def setUp(self):
        self.route = Route(
            coords=[(40.0, -90.0), (40.0, -89.0), (40.0, -88.0)],
            cum_miles=[0, 50, 150],
            cum_seconds=[0, 3600, 10800],
        )

    def test_locate_interpolates_within_segment(self):
        lat, lng, seconds = self.route.locate(100)
        self.assertAlmostEqual(lng, -88.5)
        self.assertAlmostEqual(seconds, 7200)

    def test_locate_clamps_to_route_end(self):
        self.assertEqual(self.route.locate(150)[1:], (-88.0, 10800))

    def test_forecast_picks_nearest_hour_and_clamps(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        forecast = Forecast(int(start.timestamp()), [1, 2, 3], [0, 0, 0], [0, 0, 0])
        self.assertEqual(forecast.at(start + timedelta(minutes=70)).wind_mph, 2)
        self.assertEqual(forecast.at(start - timedelta(hours=5)).wind_mph, 1)
        self.assertEqual(forecast.at(start + timedelta(days=9)).wind_mph, 3)


class PlannerTests(APISimpleTestCase):
    departure = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)

    def test_rest_added_after_eleven_driving_hours(self):
        self.assertEqual(planner._elapsed_seconds(11 * 3600), 11 * 3600)
        self.assertEqual(planner._elapsed_seconds(11 * 3600 + 1), 21 * 3600 + 1)
        self.assertEqual(planner._elapsed_seconds(23 * 3600), 43 * 3600)

    def test_sampling_interval_scales_with_distance(self):
        self.assertEqual([planner._sampling_miles(m) for m in (100, 250, 251, 750, 751)], [10, 10, 25, 25, 50])

    def test_recommends_lowest_risk_route_over_faster_one(self):
        fast = Route([(40.0, -90.0), (40.0, -88.5)], [0, 100], [0, 7200])
        slow = Route([(41.0, -90.0), (41.0, -88.5)], [0, 120], [0, 8600])
        calm = Forecast(int(self.departure.timestamp()), [5] * 100, [0] * 100, [0] * 100)
        windy = Forecast(int(self.departure.timestamp()), [40] * 100, [0] * 100, [0] * 100)

        forecasts = Forecasts(lambda key: windy if key[0] < 40.5 else calm)

        with patch.object(planner, "fetch_routes", return_value=[fast, slow]), patch.object(
            planner, "fetch_forecasts", return_value=forecasts
        ):
            plan = planner.plan_trip(
                {"lat": 40.0, "lng": -90.0}, {"lat": 40.0, "lng": -88.5}, self.departure, HEAVY
            )

        self.assertEqual(plan["recommended_route_id"], 1)
        self.assertEqual(plan["recommendation_reason"], "Fewest Severe miles")
        fast_summary = next(r for r in plan["routes"] if r["id"] == 0)
        self.assertEqual(fast_summary["miles_by_level"]["severe"], 100.0)
        self.assertEqual(fast_summary["average_risk"], 3.0)
        self.assertEqual(len(fast_summary["checkpoints"]), 11)
        self.assertEqual(len(fast_summary["checkpoints"][0]["hourly_levels"]), 49)

    def test_checkpoint_eta_uses_cumulative_drive_time(self):
        route = Route([(40.0, -90.0), (40.0, -88.5)], [0, 100], [0, 7200])
        calm = Forecast(int(self.departure.timestamp()), [5] * 100, [0] * 100, [0] * 100)
        step, samples = planner._sample(route)
        analysis = planner._analyze(0, route, step, samples, self.departure, LIGHT, Forecasts(lambda key: calm))
        etas = [c["eta"] for c in analysis["checkpoints"]]
        self.assertEqual(etas[0], self.departure.isoformat())
        self.assertEqual(etas[5], (self.departure + timedelta(hours=1)).isoformat())


class ApiTests(APITestCase):
    payload = {
        "origin": {"label": "A", "lat": 41.9, "lng": -87.6},
        "destination": {"label": "B", "lat": 39.7, "lng": -105.0},
        "load_weight_lb": 40_000,
    }

    def setUp(self):
        self.client.force_authenticate(User.objects.create_user("a@x.com", "a@x.com", "pw-123456"))

    def post(self, **overrides):
        departure = (dj_timezone.now() + timedelta(hours=2)).isoformat()
        return self.client.post("/api/trips/plan/", {**self.payload, "departure": departure, **overrides}, format="json")

    def test_validation_errors_use_standard_envelope(self):
        response = self.post(load_weight_lb=-5)
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertFalse(body["success"])
        self.assertIn("load_weight_lb", body["errors"])

    def test_rejects_past_departure_and_identical_places(self):
        past = (dj_timezone.now() - timedelta(days=1)).isoformat()
        self.assertIn("departure", self.post(departure=past).json()["errors"])
        same = self.post(destination=self.payload["origin"]).json()
        self.assertIn("non_field_errors", same["errors"])

    def test_success_envelope(self):
        with patch("routing.views.plan_trip", return_value=PLAN):
            response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"success": True, "message": "Trip planned", "data": PLAN})

    def test_requires_authentication(self):
        response = APIClient().post("/api/trips/plan/", {}, format="json")
        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.json()["success"])


PLAN = {
    "recommendation_reason": "Fewest Severe miles",
    "routes": [{"id": 0, "distance_miles": 100.0, "duration_seconds": 7200, "worst_level": 1}],
}


class AuthTests(APITestCase):
    credentials = {"email": "Driver@Example.com", "password": "correct-horse-42"}

    def test_register_login_me_logout_flow(self):
        registered = self.client.post("/api/auth/register/", self.credentials, format="json")
        self.assertEqual(registered.status_code, 201)
        self.assertEqual(registered.json()["data"]["user"]["email"], "driver@example.com")

        login = self.client.post("/api/auth/login/", self.credentials, format="json")
        token = login.json()["data"]["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(self.client.get("/api/auth/me/").json()["data"]["email"], "driver@example.com")

        self.assertEqual(self.client.post("/api/auth/logout/").status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_register_rejects_duplicate_and_weak_password(self):
        self.client.post("/api/auth/register/", self.credentials, format="json")
        duplicate = self.client.post("/api/auth/register/", self.credentials, format="json")
        self.assertIn("email", duplicate.json()["errors"])
        weak = self.client.post("/api/auth/register/", {"email": "b@x.com", "password": "12345678"}, format="json")
        self.assertIn("password", weak.json()["errors"])

    def test_login_with_wrong_password_is_unauthorized(self):
        self.client.post("/api/auth/register/", self.credentials, format="json")
        response = self.client.post("/api/auth/login/", {**self.credentials, "password": "nope-nope-1"}, format="json")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["message"], "Invalid email or password.")


class HistoryTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user("alice@x.com", "alice@x.com", "pw-123456")
        self.bob = User.objects.create_user("bob@x.com", "bob@x.com", "pw-123456")

    def plan(self):
        departure = (dj_timezone.now() + timedelta(hours=2)).isoformat()
        body = {**ApiTests.payload, "departure": departure}
        with patch("routing.views.plan_trip", return_value=PLAN):
            return self.client.post("/api/trips/plan/", body, format="json")

    def test_planning_saves_history_visible_only_to_owner(self):
        self.client.force_authenticate(self.alice)
        self.plan()
        listing = self.client.get("/api/trips/history/").json()["data"]
        self.assertEqual(len(listing), 1)
        self.assertNotIn("result", listing[0])
        self.assertEqual(listing[0]["summary"]["reason"], "Fewest Severe miles")

        detail = self.client.get(f"/api/trips/history/{listing[0]['id']}/").json()["data"]
        self.assertEqual(detail["result"], PLAN)

        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.get("/api/trips/history/").json()["data"], [])
        self.assertEqual(self.client.get(f"/api/trips/history/{listing[0]['id']}/").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/trips/history/{listing[0]['id']}/").status_code, 404)

    def test_delete_removes_entry(self):
        self.client.force_authenticate(self.alice)
        self.plan()
        entry_id = self.client.get("/api/trips/history/").json()["data"][0]["id"]
        self.assertEqual(self.client.delete(f"/api/trips/history/{entry_id}/").status_code, 200)
        self.assertEqual(self.client.get("/api/trips/history/").json()["data"], [])

    def test_history_is_capped_to_most_recent_entries(self):
        self.client.force_authenticate(self.alice)
        with patch("routing.views.MAX_HISTORY", 2):
            for _ in range(3):
                self.plan()
        self.assertEqual(self.alice.trip_searches.count(), 2)
