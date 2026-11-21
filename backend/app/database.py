import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    text,
)
from sqlalchemy.engine import Connection, Engine, URL

DEFAULT_DATABASE_PATH = Path(__file__).resolve().parents[1] / "data" / "roadwatch.db"

metadata = MetaData()
events = Table(
    "events",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("latitude", Float, nullable=False),
    Column("longitude", Float, nullable=False),
    Column("severity", String(10), nullable=False),
    Column("timestamp", DateTime(timezone=True), nullable=False),
    Column("event_type", String(20), nullable=False),
    Column("simulated", Boolean, nullable=False, default=False),
    CheckConstraint("severity IN ('low', 'medium', 'high')", name="ck_events_severity"),
    CheckConstraint(
        "event_type IN ('pothole', 'speed_bump', 'rough_road')",
        name="ck_events_event_type",
    ),
)
reports = Table(
    "community_reports",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("latitude", Float, nullable=False),
    Column("longitude", Float, nullable=False),
    Column("severity", String(10), nullable=False),
    Column("description", String(500), nullable=True),
    Column("photo_key", String(80), nullable=False, unique=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("source", String(20), nullable=False, default="community"),
    Column("status", String(20), nullable=False, default="unverified"),
    CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_reports_latitude"),
    CheckConstraint(
        "longitude >= -180 AND longitude <= 180", name="ck_reports_longitude"
    ),
    CheckConstraint(
        "severity IN ('low', 'medium', 'high')", name="ck_reports_severity"
    ),
    CheckConstraint("source = 'community'", name="ck_reports_source"),
    CheckConstraint("status = 'unverified'", name="ck_reports_status"),
)
device_events = Table(
    "device_events",
    metadata,
    Column("event_id", String(36), primary_key=True),
    Column("device_id", String(80), nullable=False),
    Column("timestamp", DateTime(timezone=True), nullable=False),
    Column("latitude", Float, nullable=True),
    Column("longitude", Float, nullable=True),
    Column("sensor_summary", String(500), nullable=False),
    Column("severity", String(10), nullable=True),
    Column("event_type", String(20), nullable=True),
    Column("received_at", DateTime(timezone=True), nullable=False),
    CheckConstraint(
        "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
        name="ck_device_events_latitude",
    ),
    CheckConstraint(
        "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
        name="ck_device_events_longitude",
    ),
    CheckConstraint(
        "severity IS NULL OR severity IN ('low', 'medium', 'high')",
        name="ck_device_events_severity",
    ),
    CheckConstraint(
        "event_type IS NULL OR event_type IN ('pothole', 'speed_bump', 'rough_road')",
        name="ck_device_events_type",
    ),
)

_engines: dict[str, Engine] = {}


def database_url() -> str:
    configured_url = os.getenv("DATABASE_URL")
    if configured_url:
        if configured_url.startswith("postgres://"):
            return configured_url.replace("postgres://", "postgresql+psycopg://", 1)
        if configured_url.startswith("postgresql://"):
            return configured_url.replace(
                "postgresql://", "postgresql+psycopg://", 1
            )
        return configured_url

    path = Path(os.getenv("ROADWATCH_DB_PATH", str(DEFAULT_DATABASE_PATH)))
    path.parent.mkdir(parents=True, exist_ok=True)
    return URL.create("sqlite", database=str(path)).render_as_string(
        hide_password=False
    )


def get_engine() -> Engine:
    url = database_url()
    if url not in _engines:
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engines[url] = create_engine(
            url,
            connect_args=connect_args,
            pool_pre_ping=True,
        )
    return _engines[url]


@contextmanager
def connect() -> Iterator[Connection]:
    with get_engine().begin() as connection:
        yield connection


def initialize_database() -> None:
    metadata.create_all(get_engine())


def event_from_row(row: Any) -> dict[str, Any]:
    event = dict(row)
    timestamp = event["timestamp"]
    if isinstance(timestamp, str):
        timestamp = datetime.fromisoformat(timestamp)
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    event["timestamp"] = timestamp.astimezone(timezone.utc)
    event["simulated"] = bool(event["simulated"])
    return event
