# Weather-Aware Truck Routing

React + Django app that recommends the safest of three truck routes by sampling the forecast at the truck's *estimated arrival time* at each checkpoint, scoring it against the provided risk and load rules, and showing everything on a map with a 0–48 h weather heatmap. Users sign up with email and password, and every route check is saved to their history.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, MapLibre GL (via react-map-gl) |
| Backend | Django 6, Django REST Framework (token auth), SQLite locally / PostgreSQL in production |
| Routing | [OSRM](https://project-osrm.org) (3 route options) |
| Weather | [Open-Meteo](https://open-meteo.com) hourly forecast (no key) |
| Geocoding | [Photon](https://photon.komoot.io) (OSM) autocomplete |

No third-party API keys are needed.

## Configuration

Secrets and settings are read from `.env` files only (all git-ignored, each with a committed `.env.example`):

| File | Used by | Holds |
| --- | --- | --- |
| `.env` | docker compose | `POSTGRES_DB/USER/PASSWORD`, `SITE_ADDRESS`, `DB_PORT`, `API_PORT` |
| `backend/.env` | Django | `DJANGO_SECRET_KEY` (required), `DJANGO_ALLOWED_HOSTS` (required), debug, CORS, upstream URLs, throttles |
| `frontend/.env` | Vite | `VITE_API_URL` (empty = same origin), `API_PROXY` |

```bash
cp .env.example .env && cp backend/.env.example backend/.env && cp frontend/.env.example frontend/.env
# fill DJANGO_SECRET_KEY and POSTGRES_PASSWORD (use a hex password so DATABASE_URL needs no escaping)
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

## Run with Docker

```bash
# local: Postgres + Django runserver + Vite, source mounted for hot reload
docker compose -f docker-compose.local.yml up --build      # http://localhost:5173 (API on :8000)

# production build: Postgres + gunicorn + nginx (static SPA) behind Caddy, which routes /api and handles HTTPS
docker compose up -d --build                                # http://localhost when SITE_ADDRESS=:80
```

Each service has its own Dockerfile (`Dockerfile` for production, `Dockerfile.local` for development). The production API image is a multi-stage build that runs as a non-root user, applies migrations on start and sits behind Caddy (`Caddyfile` at the repo root, its own compose service), so the browser only talks to one origin. Only Caddy publishes ports (80/443, with automatic Let's Encrypt certificates when `SITE_ADDRESS` is a domain); the database stays on the internal network.

## Run without Docker

```bash
# backend  (http://localhost:8000, SQLite unless DATABASE_URL is set)
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver

# frontend (http://localhost:5173, proxies /api to API_PROXY)
cd frontend
npm install
npm run dev
```

Tests and checks:

```bash
cd backend && python manage.py test        # risk rules, ETAs, ranking, auth, history, API envelope
cd frontend && npm run lint && npm run build
```

## How it works

`POST /api/trips/plan/` runs this pipeline (`backend/routing/planner.py`):

1. **Routes** – OSRM returns up to 3 alternatives with per-segment distance/duration. If it returns fewer, perpendicular via-point detours (±20 %, ±40 % of the trip length) fill the gap; candidates that overlap an existing route by ≥85 % or exceed 1.5× the fastest distance are dropped.
2. **Checkpoints** – every 10 / 25 / 50 miles depending on trip length (≤250 / ≤750 / longer), plus the start and end. The interval scales with distance to keep weather calls bounded.
3. **ETA** – cumulative OSRM segment durations (its car profile already averages ~56 mph, close to truck speeds) plus a mandatory 10 h rest after every 11 h of driving (FMCSA hours-of-service). Long trips are therefore evaluated against the weather the truck will actually meet days later.
4. **Weather** – one batched Open-Meteo call per ~50 unique locations, run in parallel and cached for 30 min. Each checkpoint uses the hour nearest its ETA: sustained 10 m wind (mph), rain + showers (in/h), snowfall (in/h).
5. **Risk** – `routing/risk.py` classifies each condition (lower bound inclusive; Rain/Snow *No Travel* is strictly above the top limit, as in the table), applies the load rules to wind, and takes the worst condition. The checkpoint's level is the worst of the three, and the driving condition is reported.
6. **Route metrics** – each checkpoint owns the road halfway to its neighbours, so miles per risk level sum to the route length. Average risk is mile-weighted on a 0–4 scale.
7. **Recommendation** – routes are ordered lexicographically by: *No Travel miles*, *Severe miles*, *High miles*, *average risk*, *travel time*. No Travel is checked first because a route with a closed segment is worse than one that is merely Severe. The response explains the deciding criterion.
8. **Heatmap data** – every checkpoint also carries 49 `hourly_levels` (departure + 0…48 h), so the slider works fully client-side with no requests.

### API

All endpoints use the helpers in `backend/core/responses.py`, including validation, auth and upstream errors via a custom DRF exception handler:

```json
{ "success": true,  "message": "Trip planned", "data": { } }
{ "success": false, "message": "Validation failed", "errors": { "load_weight_lb": ["..."] } }
```

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/register/` | public | `email`, `password` → `{ token, user }` |
| `POST /api/auth/login/` | public | `email`, `password` → `{ token, user }` |
| `POST /api/auth/logout/` | token | Revokes the token |
| `GET /api/auth/me/` | token | Current user |
| `GET /api/geocode/?q=` | token | Place autocomplete |
| `POST /api/trips/plan/` | token | `origin`, `destination` (`label`, `lat`, `lng`), `departure` (ISO), `load_weight_lb`; saves the result to history |
| `GET /api/trips/history/` | token | Your latest checks (summary only) |
| `GET /api/trips/history/<id>/` | token | One saved check with its full result |
| `DELETE /api/trips/history/<id>/` | token | Delete a saved check |
| `GET /api/health/` | public | Health check |

Send the token as `Authorization: Token <key>`.

### Auth & history

- Django's `User` with the email as username (stored lowercase) and Django's password validators; DRF `TokenAuthentication`, so logout really revokes access. The frontend keeps the token in `localStorage` and returns to the login screen on any `401`.
- Every plan is stored as a `TripSearch` row (request, small `summary`, and the full result snapshot). The list endpoint defers the large `result` column, queries are always scoped to `request.user` (other users' ids return `404`), and only the latest 50 checks per user are kept.
- Viewing a saved check shows the stored snapshot, not fresh weather; the UI says so, and you can run a new check at any time.
- Throttling: 20 req/min per IP on anonymous endpoints (slows password guessing), 60 req/min per user.

### Map & performance

- Routes, checkpoints (colored by risk, click for ETA and weather) and the heatmap are MapLibre WebGL layers.
- Heatmap radius follows the checkpoint spacing at every zoom so neighbouring checkpoints blend into a continuous corridor without inflating risk.
- Slider moves only update a ~50-point GeoJSON source.
- Route geometry is simplified server-side (Douglas–Peucker) and responses are gzipped (~20 KB for a 1,000-mile trip).

## Deploy to a server (EC2 + Docker)

1. Open ports 80, 443 (TCP and UDP) in the security group; keep 22 restricted to your IP. Install Docker with the compose plugin.
2. Copy the repo to the server and create the three production env files from the `.env.example` files (`SITE_ADDRESS` = your domain or public DNS name, `DJANGO_ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS` to match, `NUM_PROXIES=1`, fresh `DJANGO_SECRET_KEY` and `POSTGRES_PASSWORD`).
3. `docker compose up -d --build`. Caddy obtains the certificate on first request; the app is then served at `https://<SITE_ADDRESS>`.

The Postgres password is only applied when the data volume is first created; change it later with `ALTER USER`, not by editing `.env`.

## Deploy to Render

`render.yaml` is a Render blueprint (Django on gunicorn + PostgreSQL + static Vite site; migrations run in the build step). After the first deploy set `CORS_ALLOWED_ORIGINS` on the API to the site URL and `VITE_API_URL` on the site to the API URL, then redeploy the site. Backend settings are the keys in `backend/.env.example` plus `DATABASE_URL` (defaults to local SQLite) and `NUM_PROXIES` (set to `1` behind Caddy so throttling sees real client IPs).

## Known limitations

- OSRM, Open-Meteo and Photon are public demo endpoints; point `OSRM_URL` at your own instance for real traffic. OSRM's car profile ignores truck restrictions (height, weight, hazmat).
- Departure must be within the next 7 days (forecast horizon is 14 days); ETAs past the horizon use the last available hour.
- Wind uses sustained speed, not gusts; switching to gusts is a two-line change in `services._fetch_forecast_batch`.
- Geocoding is limited to North America.
- Tokens don't expire until logout; add expiry or switch to short-lived JWTs if sessions need a lifetime.
