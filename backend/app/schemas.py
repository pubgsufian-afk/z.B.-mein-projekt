from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: EmailStr
    is_admin: bool


class TimeEntryCreate(BaseModel):
    work_date: date
    start_time: time
    end_time: time
    break_minutes: int = Field(ge=0, le=600)
    note: str = ""


class TimeEntryUpdate(BaseModel):
    work_date: date
    start_time: time
    end_time: time
    break_minutes: int = Field(ge=0, le=600)
    note: str = ""
    approved: bool = False


class TimeEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    work_date: date
    start_time: time
    end_time: time
    break_minutes: int
    note: str
    approved: bool
    created_at: datetime


class MonthlySummary(BaseModel):
    entries: list[TimeEntryResponse]
    total_hours: float
