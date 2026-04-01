import calendar
import csv
import io
import os
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .models import TimeEntry, User
from .schemas import (
    LoginRequest,
    MonthlySummary,
    TimeEntryCreate,
    TimeEntryResponse,
    TimeEntryUpdate,
    TokenResponse,
    UserCreate,
    UserResponse,
)
from .security import create_access_token, get_current_admin, get_current_user, get_password_hash, verify_password

Base.metadata.create_all(bind=engine)


def _resolve_allowed_origins() -> list[str]:
    allowed_origins = os.getenv("ALLOWED_ORIGINS")
    frontend_url = os.getenv("FRONTEND_URL")

    if allowed_origins:
        origins = [origin.strip() for origin in allowed_origins.split(",") if origin.strip()]
        if origins:
            return origins
    if frontend_url and frontend_url.strip():
        return [frontend_url.strip()]

    raise RuntimeError("CORS-Konfiguration fehlt. Bitte ALLOWED_ORIGINS oder FRONTEND_URL setzen.")


app = FastAPI(title="Mitarbeiter Zeiterfassung")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def ensure_initial_admin() -> None:
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")
    admin_full_name = os.getenv("ADMIN_FULL_NAME")

    if not admin_email or not admin_password or not admin_full_name:
        raise RuntimeError(
            "ADMIN_EMAIL, ADMIN_PASSWORD und ADMIN_FULL_NAME müssen gesetzt sein, um den initialen Admin bereitzustellen."
        )

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == admin_email).first()
        if not admin:
            admin = User(
                full_name=admin_full_name,
                email=admin_email,
                hashed_password=get_password_hash(admin_password),
                is_admin=True,
            )
            db.add(admin)
            db.commit()
    finally:
        db.close()


def calc_hours(entry: TimeEntry) -> float:
    start = datetime.combine(entry.work_date, entry.start_time)
    end = datetime.combine(entry.work_date, entry.end_time)
    minutes = (end - start).total_seconds() / 60 - entry.break_minutes
    return max(0, round(minutes / 60, 2))


@app.post("/auth/register", response_model=UserResponse)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="E-Mail bereits vergeben")
    user = User(
        full_name=payload.full_name,
        email=payload.email,
        hashed_password=get_password_hash(payload.password),
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Falsche Zugangsdaten")
    token = create_access_token({"sub": str(user.id), "is_admin": user.is_admin})
    return TokenResponse(access_token=token)


@app.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@app.post("/entries", response_model=TimeEntryResponse)
def create_entry(payload: TimeEntryCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.end_time <= payload.start_time:
        raise HTTPException(status_code=400, detail="Endzeit muss nach Startzeit liegen")
    entry = TimeEntry(user_id=current_user.id, **payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@app.get("/entries/monthly", response_model=MonthlySummary)
def monthly(month: int, year: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Monat ungültig")
    last_day = calendar.monthrange(year, month)[1]
    start_date = datetime(year, month, 1).date()
    end_date = datetime(year, month, last_day).date()

    entries = (
        db.query(TimeEntry)
        .filter(TimeEntry.user_id == current_user.id, TimeEntry.work_date >= start_date, TimeEntry.work_date <= end_date)
        .order_by(TimeEntry.work_date.asc())
        .all()
    )
    total = round(sum(calc_hours(entry) for entry in entries), 2)
    return MonthlySummary(entries=entries, total_hours=total)


@app.get("/admin/users", response_model=list[UserResponse])
def list_users(db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    return db.query(User).order_by(User.full_name.asc()).all()


@app.get("/admin/entries", response_model=list[TimeEntryResponse])
def list_entries(db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    return db.query(TimeEntry).order_by(TimeEntry.work_date.desc()).all()


@app.put("/admin/entries/{entry_id}", response_model=TimeEntryResponse)
def admin_update_entry(
    entry_id: int,
    payload: TimeEntryUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    entry = db.query(TimeEntry).filter(TimeEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")
    if payload.end_time <= payload.start_time:
        raise HTTPException(status_code=400, detail="Endzeit muss nach Startzeit liegen")

    for field, value in payload.model_dump().items():
        setattr(entry, field, value)
    entry.approved_by = admin.id if payload.approved else None

    db.commit()
    db.refresh(entry)
    return entry


@app.get("/admin/export/csv")
def export_csv(db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "mitarbeiter", "datum", "start", "ende", "pause_min", "stunden", "freigegeben", "notiz"])

    entries = db.query(TimeEntry).order_by(TimeEntry.work_date.asc()).all()
    for entry in entries:
        user = db.query(User).filter(User.id == entry.user_id).first()
        writer.writerow(
            [
                entry.id,
                user.full_name if user else "N/A",
                entry.work_date.isoformat(),
                entry.start_time.isoformat(),
                entry.end_time.isoformat(),
                entry.break_minutes,
                calc_hours(entry),
                "Ja" if entry.approved else "Nein",
                entry.note,
            ]
        )

    output.seek(0)
    headers = {"Content-Disposition": "attachment; filename=zeiterfassung_export.csv"}
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers=headers)


@app.get("/admin/export/pdf")
def export_pdf(db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    pdf.setTitle("Zeiterfassung Export")
    y = 800

    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(50, y, "Zeiterfassung - Export")
    y -= 30
    pdf.setFont("Helvetica", 9)

    entries = db.query(TimeEntry).order_by(TimeEntry.work_date.asc()).all()
    for entry in entries:
        user = db.query(User).filter(User.id == entry.user_id).first()
        line = f"{entry.work_date} | {user.full_name if user else 'N/A'} | {entry.start_time}-{entry.end_time} | Pause {entry.break_minutes}m | {calc_hours(entry)}h | {'Freigegeben' if entry.approved else 'Offen'}"
        pdf.drawString(50, y, line[:120])
        y -= 15
        if y < 50:
            pdf.showPage()
            pdf.setFont("Helvetica", 9)
            y = 800

    pdf.save()
    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=zeiterfassung_export.pdf"}
    return StreamingResponse(buffer, media_type="application/pdf", headers=headers)
