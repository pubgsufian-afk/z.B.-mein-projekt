import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Fallback bleibt absichtlich SQLite für lokale Entwicklung.
DEFAULT_SQLITE_DATABASE_URL = "sqlite:///./time_tracking.db"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_SQLITE_DATABASE_URL)

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
