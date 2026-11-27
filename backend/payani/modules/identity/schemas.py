import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

PASSWORD_MIN = 12
PASSWORD_MAX = 128


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Please enter your name.")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if v.strip() != v:
            raise ValueError("Password must not start or end with spaces.")
        if len(set(v)) < 5:
            raise ValueError("Password is too repetitive.")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    locale: str
    timezone: str
    email_verified: bool
    roles: list[str]
    permissions: list[str]
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth token type, not a secret
    expires_in: int
    user: UserOut


class RoleAssignment(BaseModel):
    roles: list[str] = Field(min_length=1, max_length=3)


class AdminUserOut(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    status: str
    roles: list[str]
    created_at: datetime
    last_login_at: datetime | None
