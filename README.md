# Mitarbeiter-Zeiterfassung (Full-Stack Web-App)

Komplette Web-App für Zeiterfassung mit **Frontend, Backend und Datenbank**.

## Funktionen

- Eigener Login pro Mitarbeiter
- Tägliche Zeiterfassung mit: Datum, Startzeit, Endzeit, Pause, Notiz
- Monatsübersicht pro Mitarbeiter
- Automatische Berechnung der Monatsstunden
- Admin sieht alle Mitarbeiter und alle Einträge
- Admin kann Einträge bearbeiten/freigeben
- Export als CSV und PDF
- Responsive UI für Smartphone und Desktop
- Sichere Benutzerverwaltung (JWT + Passwort-Hashing)
- Persistente Speicherung in SQLite
- Leicht deploybar mit Docker

## Tech-Stack

- **Backend:** FastAPI + SQLAlchemy + SQLite
- **Auth/Sicherheit:** JWT (`python-jose`) + `passlib` (bcrypt)
- **Frontend:** React + Vite
- **Export:** CSV + PDF (ReportLab)
- **Deployment:** Docker / Docker Compose

## Projektstruktur

```text
backend/
  app/
    main.py
    models.py
    schemas.py
    security.py
    database.py
  requirements.txt
  Dockerfile

frontend/
  src/
    App.jsx
    main.jsx
    styles.css
  package.json
  Dockerfile

docker-compose.yml
```

## Lokal starten (empfohlen)

```bash
docker compose up --build
```

Danach:
- Frontend: http://localhost:5173
- API: http://localhost:8000/docs

## Ohne Docker starten

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

## Rollenmodell

- **Mitarbeiter:** eigener Login, eigene Einträge, Monatsübersicht
- **Admin:** zusätzlich Übersicht über alle Mitarbeiter + alle Einträge, Freigabe/Änderung, Export

> In der UI können für Demo-Zwecke sowohl Mitarbeiter- als auch Admin-Accounts registriert werden.

## API-Endpunkte

- `POST /auth/register`
- `POST /auth/login`
- `GET /me`
- `POST /entries`
- `GET /entries/monthly?month=MM&year=YYYY`
- `GET /admin/users` (Admin)
- `GET /admin/entries` (Admin)
- `PUT /admin/entries/{id}` (Admin)
- `GET /admin/export/csv` (Admin)
- `GET /admin/export/pdf` (Admin)

## Online Deployment (einfach)

### Option A: VPS (z. B. Hetzner, IONOS, DigitalOcean)

1. Repo auf den Server klonen.
2. Docker + Docker Compose installieren.
3. `docker compose up -d --build` ausführen.
4. Nginx/Caddy als Reverse-Proxy davor schalten.
5. TLS/HTTPS mit Let's Encrypt aktivieren.

### Option B: Render / Railway

- **Backend** als Docker-Webservice deployen (Port 8000).
- **Frontend** als Docker-Webservice deployen (Port 5173) oder statisch bauen und als Static Site hosten.
- `VITE_API_BASE` auf die öffentliche Backend-URL setzen.

## Sicherheitshinweise für Produktion

- `SECRET_KEY` in `backend/app/security.py` auf einen starken Wert setzen (besser via Umgebungsvariable).
- CORS in `backend/app/main.py` nur für eigene Domain konfigurieren.
- SQLite für kleine Teams ok; bei Wachstum auf PostgreSQL umstellen.
- Logging, Rate-Limits, Backups und Monitoring ergänzen.
