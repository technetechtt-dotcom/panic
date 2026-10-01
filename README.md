# GUARDIAN

Personal safety and emergency-response platform. Milestone 1 is a working path for a deliberate manual SOS: the Android app stores the incident on the phone first, the API creates one incident per trigger, and a monitoring operator can see the location, heartbeat, and timeline and then acknowledge or resolve it.

This is not a replacement for official emergency services.

## What this version does

- Android account registration and login, device registration, a protection-status home screen, a manual SOS button, practice mode, local incident history, distress-capsule upload, location points, and an emergency heartbeat.
- NestJS API with PostgreSQL, Redis health and an optional Socket.IO adapter, JWT access tokens, rotating refresh tokens, role checks, audit events, and WebSocket updates for operators.
- Monitoring web app: operator login, active incident list, incident detail with a map, heartbeat, timeline, acknowledge, and resolve.

Volume-button SOS, voice safe-word detection, guardian contacts, evidence capture, duress PIN entry, journey protection, and AI assistance are later milestones. The home screen says so. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Layout

```
guardian/
  apps/android/          Kotlin app. :core is pure safety logic. :app is the Android UI and services.
  apps/monitoring-web/   React operator console
  services/api/          NestJS API
  packages/shared-types/
  packages/shared-validation/
  infrastructure/docker/
  docs/
```

Suggested feature names such as `feature-sos` are Kotlin packages inside `:app` in this version. They are not separate Gradle modules yet.

## Run the API and dashboard

Requirements: Node.js 22 or newer, Docker, and a copy of `.env.example` named `.env`.

```powershell
copy .env.example .env
# Set POSTGRES_PASSWORD, DATABASE_URL, JWT_ACCESS_SECRET (32+ characters),
# MONITOR_OPERATOR_EMAIL, and MONITOR_OPERATOR_PASSWORD (12+ characters).

docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up -d
# If Docker is not running, start a local PostgreSQL instead:
# npm run dev:db
npm install
npm run prisma:migrate -w @guardian/api
npm run seed:operator -w @guardian/api
npm run dev:api
npm run dev:web
```

The dashboard is at `http://localhost:5173`. The API is at `http://localhost:3000/api/v1`. Vite proxies `/api` and `/socket.io` to the API.

Public registration always creates a `USER`. Operator accounts are created only by the seed script.

## Android

Open `apps/android` in Android Studio, or build a debug APK:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd apps\android
.\gradlew.bat :app:assembleDebug
```

The debug build talks to `http://10.0.2.2:3000/api/v1/` so an emulator can reach an API on the host. A physical phone needs a different base URL. Release builds do not allow cleartext HTTP.

## Tests

```powershell
npm test
cd apps\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat :core:test :app:testDebugUnitTest
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Incident flow](docs/INCIDENT_FLOW.md)
- [API](docs/API.md)
- [Data model](docs/DATA_MODEL.md)
- [Security](docs/SECURITY.md)
- [Privacy](docs/PRIVACY.md)
- [Android limitations](docs/ANDROID_LIMITATIONS.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
- [Roadmap](docs/ROADMAP.md)
