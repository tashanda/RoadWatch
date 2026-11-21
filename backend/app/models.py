from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

Severity = Literal["low", "medium", "high"]
EventType = Literal["pothole", "speed_bump", "rough_road"]


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    severity: Severity
    timestamp: AwareDatetime
    event_type: EventType
    simulated: bool = False

    @field_validator("timestamp")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        normalized = value.astimezone(timezone.utc)
        if normalized > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError("timestamp cannot be more than five minutes in the future")
        return normalized


class Event(EventCreate):
    id: int


class EventList(BaseModel):
    items: list[Event]
    total: int


class CommunityReport(BaseModel):
    id: UUID
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    severity: Severity
    description: str | None = Field(default=None, max_length=500)
    photo_url: str
    created_at: AwareDatetime
    source: Literal["community"] = "community"
    status: Literal["unverified"] = "unverified"


class CommunityReportList(BaseModel):
    items: list[CommunityReport]
    total: int


class DeviceEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    device_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    timestamp: AwareDatetime
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    sensor_summary: str = Field(min_length=1, max_length=500)
    severity: Severity | None = None
    event_type: EventType | None = None
    impact_magnitude: float | None = Field(default=None, ge=0, le=200)
    source: Literal["esp32_sensor"] = "esp32_sensor"
    status: Literal["unverified"] = "unverified"

    @model_validator(mode="after")
    def validate_coordinates_and_classification(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must both be provided or omitted")
        if (self.severity is None) != (self.event_type is None):
            raise ValueError("severity and event_type must be provided together")
        return self

    @field_validator("timestamp")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        normalized = value.astimezone(timezone.utc)
        if normalized > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError("timestamp cannot be more than five minutes in the future")
        return normalized


class DeviceEvent(DeviceEventCreate):
    received_at: AwareDatetime


class DeviceEventIngestResponse(BaseModel):
    event: DeviceEvent
    duplicate: bool


class DeviceEventList(BaseModel):
    items: list[DeviceEvent]
    total: int
