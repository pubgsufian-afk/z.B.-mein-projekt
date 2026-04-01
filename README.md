# Mitarbeiter-Zeiterfassung

## Pflicht-Umgebungsvariablen

Lege eine `.env` im Projektroot an (wird von `docker compose` genutzt):

```env
SECRET_KEY=bitte-einen-langen-zufallswert-setzen
DATABASE_URL=sqlite:////data/time_tracking.db
ALLOWED_ORIGINS=http://localhost:5173
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=BitteSicheresPasswort123!
ADMIN_FULL_NAME=System Admin
VITE_API_BASE=http://localhost:8000
```

Hinweise:
- `SECRET_KEY` ist verpflichtend. Ohne diese Variable startet das Backend nicht.
- `DATABASE_URL` nutzt standardmäßig `sqlite:////data/time_tracking.db` (persistentes Docker-Volume).
- Alternativ zu `ALLOWED_ORIGINS` kann `FRONTEND_URL` genutzt werden, falls kein Origins-CSV verwendet wird.

## Erster Admin

Beim Backend-Start wird automatisch ein Admin mit `ADMIN_EMAIL`, `ADMIN_PASSWORD` und `ADMIN_FULL_NAME` angelegt, falls dieser noch nicht existiert.

## Lokal starten

```bash
docker compose up --build
```

Danach:
- Frontend: http://localhost:5173
- Backend: http://localhost:8000/docs

## Live-Deployment

1. Gleiche Container-Konfiguration (Docker Compose) auf dem Server nutzen.
2. `.env` mit produktiven Werten setzen (insbesondere `SECRET_KEY`, `ADMIN_*`, `ALLOWED_ORIGINS`, `VITE_API_BASE`).
3. Mit `docker compose up -d --build` deployen.
4. Reverse-Proxy (z. B. Nginx/Caddy) + HTTPS (Let's Encrypt) vorschalten.
