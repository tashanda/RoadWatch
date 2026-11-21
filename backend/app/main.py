import logging
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

import httpx
from fastapi import (
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError

from app.database import (
    connect,
    device_events,
    event_from_row,
    events,
    initialize_database,
    reports,
)
from app.models import (
    CommunityReport,
    CommunityReportList,
    DeviceEvent,
    DeviceEventCreate,
    DeviceEventIngestResponse,
    DeviceEventList,
    Event,
    EventCreate,
    EventList,
    Severity,
)

logger = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
REPORT_RATE_LIMIT = 5
REPORT_RATE_WINDOW_SECONDS = 60 * 60
_report_submissions: dict[str, list[float]] = {}
_report_submissions_lock = threading.Lock()
_last_rate_limit_cleanup = 0.0


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="RoadWatch API", version="0.2.0", lifespan=lifespan)

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        os.getenv(
            "ROADWATCH_CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        ),
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Device-Token"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _report_storage_config() -> tuple[str, str, str] | None:
    configured = [
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        os.getenv("SUPABASE_STORAGE_BUCKET"),
    ]
    if any(configured) and not all(configured):
        raise HTTPException(
            status_code=503,
            detail="Supabase storage requires SUPABASE_URL, "
            "SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET.",
        )
    if all(configured):
        return configured[0].rstrip("/"), configured[1], configured[2]
    if os.getenv("ROADWATCH_ENV", "development").lower() == "production":
        raise HTTPException(
            status_code=503,
            detail="Report storage is not configured for production.",
        )
    return None


def _local_upload_path(photo_key: str) -> Path:
    upload_dir = Path(
        os.getenv(
            "ROADWATCH_UPLOAD_DIR",
            str(Path(__file__).resolve().parents[1] / "data" / "uploads"),
        )
    )
    return upload_dir / photo_key


def _sanitize_image(raw: bytes) -> bytes:
    try:
        with Image.open(BytesIO(raw)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(
                    status_code=415,
                    detail="Photo must be a valid JPG, PNG, or WebP image.",
                )
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413, detail="Photo dimensions are too large."
                )
            image.load()
            clean_image = ImageOps.exif_transpose(image).convert("RGB")
            output = BytesIO()
            clean_image.save(output, format="JPEG", quality=88, optimize=True)
            return output.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise HTTPException(
            status_code=415,
            detail="Photo content is not a valid supported image.",
        ) from error


def _check_report_rate_limit(request: Request) -> None:
    global _last_rate_limit_cleanup
    client_host = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _report_submissions_lock:
        if now - _last_rate_limit_cleanup >= REPORT_RATE_WINDOW_SECONDS:
            expired_hosts = [
                host
                for host, submissions in _report_submissions.items()
                if not any(now - item < REPORT_RATE_WINDOW_SECONDS for item in submissions)
            ]
            for host in expired_hosts:
                del _report_submissions[host]
            _last_rate_limit_cleanup = now
        recent = [
            item
            for item in _report_submissions.get(client_host, [])
            if now - item < REPORT_RATE_WINDOW_SECONDS
        ]
        if len(recent) >= REPORT_RATE_LIMIT:
            raise HTTPException(
                status_code=429,
                detail="Too many reports from this connection. Try again later.",
                headers={"Retry-After": str(REPORT_RATE_WINDOW_SECONDS)},
            )
        recent.append(now)
        _report_submissions[client_host] = recent


async def _store_photo(photo_key: str, image_bytes: bytes) -> None:
    storage = _report_storage_config()
    if storage is None:
        try:
            path = _local_upload_path(photo_key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(image_bytes)
        except OSError as error:
            logger.exception("Could not save report photo to local storage")
            raise HTTPException(
                status_code=503, detail="Local photo storage is unavailable."
            ) from error
        return
    base_url, service_key, bucket = storage
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{base_url}/storage/v1/object/{bucket}/{photo_key}",
                content=image_bytes,
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Content-Type": "image/jpeg",
                    "x-upsert": "false",
                },
            )
    except httpx.HTTPError as error:
        logger.exception("Supabase photo upload request failed")
        raise HTTPException(
            status_code=502, detail="Photo storage is unavailable."
        ) from error
    if response.status_code not in {200, 201}:
        logger.error("Supabase photo upload failed with HTTP %s", response.status_code)
        raise HTTPException(
            status_code=502, detail="Photo storage could not save this upload."
        )


async def _delete_photo(photo_key: str) -> None:
    storage = _report_storage_config()
    if storage is None:
        try:
            _local_upload_path(photo_key).unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not remove orphaned local report photo")
        return
    base_url, service_key, bucket = storage
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.delete(
                f"{base_url}/storage/v1/object/{bucket}/{photo_key}",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                },
            )
        if response.status_code not in {200, 204}:
            logger.error(
                "Could not remove orphaned Supabase photo (HTTP %s)",
                response.status_code,
            )
    except httpx.HTTPError:
        logger.exception("Could not remove orphaned Supabase photo")


def _report_from_row(row: object) -> CommunityReport:
    report = dict(row)
    created_at = report["created_at"]
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return CommunityReport(
        id=report["id"],
        latitude=report["latitude"],
        longitude=report["longitude"],
        severity=report["severity"],
        description=report["description"],
        photo_url=f"/api/reports/{report['id']}/photo",
        created_at=created_at.astimezone(timezone.utc),
        source=report["source"],
        status=report["status"],
    )


def _device_event_from_row(row: object) -> dict[str, object]:
    event = dict(row)
    for field in ("timestamp", "received_at"):
        value = event[field]
        if isinstance(value, str):
            value = datetime.fromisoformat(value)
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        event[field] = value.astimezone(timezone.utc)
    return event


@app.post(
    "/api/reports",
    response_model=CommunityReport,
    status_code=status.HTTP_201_CREATED,
)
async def create_report(
    request: Request,
    latitude: Annotated[float, Form(ge=-90, le=90)],
    longitude: Annotated[float, Form(ge=-180, le=180)],
    severity: Annotated[Severity, Form()],
    photo: Annotated[UploadFile, File()],
    description: Annotated[str | None, Form(max_length=500)] = None,
) -> CommunityReport:
    _check_report_rate_limit(request)
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            request_size = int(content_length)
        except ValueError as error:
            raise HTTPException(
                status_code=400, detail="Invalid request size."
            ) from error
        if request_size > MAX_IMAGE_BYTES + 65_536:
            raise HTTPException(
                status_code=413, detail="Photo must be 5 MB or smaller."
            )
    raw_image = await photo.read(MAX_IMAGE_BYTES + 1)
    if not raw_image:
        raise HTTPException(status_code=400, detail="A photo is required.")
    if len(raw_image) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Photo must be 5 MB or smaller.")
    image_bytes = _sanitize_image(raw_image)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Processed photo must be 5 MB or smaller.",
        )
    report_id = uuid4()
    photo_key = f"{report_id.hex}.jpg"
    await _store_photo(photo_key, image_bytes)
    created_at = datetime.now(timezone.utc)
    try:
        with connect() as connection:
            row = connection.execute(
                reports.insert()
                .values(
                    id=str(report_id),
                    latitude=latitude,
                    longitude=longitude,
                    severity=severity,
                    description=(description.strip() or None) if description else None,
                    photo_key=photo_key,
                    created_at=created_at,
                    source="community",
                    status="unverified",
                )
                .returning(reports)
            ).mappings().one()
    except SQLAlchemyError as error:
        await _delete_photo(photo_key)
        logger.exception("Could not save report metadata")
        raise HTTPException(
            status_code=503, detail="Report metadata could not be saved."
        ) from error
    return _report_from_row(row)


@app.get("/api/reports", response_model=CommunityReportList)
def list_reports(
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> CommunityReportList:
    with connect() as connection:
        rows = connection.execute(
            reports.select().order_by(reports.c.created_at.desc()).limit(limit)
        ).mappings().all()
        total = connection.execute(
            text("SELECT COUNT(*) FROM community_reports")
        ).scalar_one()
    return CommunityReportList(
        items=[_report_from_row(row) for row in rows],
        total=total,
    )


@app.get("/api/reports/{report_id}", response_model=CommunityReport)
def get_report(report_id: UUID) -> CommunityReport:
    with connect() as connection:
        row = connection.execute(
            reports.select().where(reports.c.id == str(report_id))
        ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return _report_from_row(row)


@app.get("/api/reports/{report_id}/photo")
async def get_report_photo(report_id: UUID) -> Response:
    with connect() as connection:
        row = connection.execute(
            reports.select().where(reports.c.id == str(report_id))
        ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")

    storage = _report_storage_config()
    if storage is None:
        path = _local_upload_path(row["photo_key"])
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Report photo not found")
        return FileResponse(path, media_type="image/jpeg")

    base_url, service_key, bucket = storage
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                f"{base_url}/storage/v1/object/{bucket}/{row['photo_key']}",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                },
            )
    except httpx.HTTPError as error:
        logger.exception("Could not retrieve report photo from Supabase")
        raise HTTPException(
            status_code=502, detail="Report photo storage is unavailable."
        ) from error
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Report photo not found")
    if response.status_code != 200:
        logger.error(
            "Supabase photo retrieval failed with HTTP %s", response.status_code
        )
        raise HTTPException(
            status_code=502, detail="Report photo storage is unavailable."
        )
    return Response(content=response.content, media_type="image/jpeg")


@app.post(
    "/api/device-events",
    response_model=DeviceEventIngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def ingest_device_event(
    payload: DeviceEventCreate,
    x_device_token: Annotated[str | None, Header()] = None,
) -> DeviceEventIngestResponse:
    expected_token = os.getenv("ROADWATCH_DEVICE_TOKEN")
    if not expected_token:
        raise HTTPException(
            status_code=503, detail="Device event ingestion is not configured."
        )
    if x_device_token is None or not secrets.compare_digest(
        x_device_token, expected_token
    ):
        raise HTTPException(status_code=401, detail="Invalid device token.")

    with connect() as connection:
        existing = connection.execute(
            device_events.select().where(
                device_events.c.event_id == str(payload.event_id)
            )
        ).mappings().first()
        if existing is not None:
            if existing["device_id"] != payload.device_id:
                raise HTTPException(
                    status_code=409, detail="Event ID is already in use."
                )
            return DeviceEventIngestResponse(
                event=DeviceEvent.model_validate(_device_event_from_row(existing)),
                duplicate=True,
            )
        received_at = datetime.now(timezone.utc)
        insert_statement = (
            sqlite_insert(device_events)
            if connection.dialect.name == "sqlite"
            else pg_insert(device_events)
        )
        result = connection.execute(
            insert_statement
            .values(
                event_id=str(payload.event_id),
                device_id=payload.device_id,
                timestamp=payload.timestamp,
                latitude=payload.latitude,
                longitude=payload.longitude,
                sensor_summary=payload.sensor_summary,
                severity=payload.severity,
                event_type=payload.event_type,
                impact_magnitude=payload.impact_magnitude,
                source=payload.source,
                status=payload.status,
                received_at=received_at,
            )
            .on_conflict_do_nothing(index_elements=[device_events.c.event_id])
            .returning(device_events)
        )
        row = result.mappings().first()
        if row is None:
            row = connection.execute(
                device_events.select().where(
                    device_events.c.event_id == str(payload.event_id)
                )
            ).mappings().one()
            if row["device_id"] != payload.device_id:
                raise HTTPException(
                    status_code=409, detail="Event ID is already in use."
                )
            return DeviceEventIngestResponse(
                event=DeviceEvent.model_validate(_device_event_from_row(row)),
                duplicate=True,
            )
    return DeviceEventIngestResponse(
        event=DeviceEvent.model_validate(_device_event_from_row(row)),
        duplicate=False,
    )


@app.get("/api/device-events", response_model=DeviceEventList)
def list_device_events(
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> DeviceEventList:
    with connect() as connection:
        rows = connection.execute(
            device_events.select()
            .order_by(device_events.c.timestamp.desc())
            .limit(limit)
        ).mappings().all()
        total = connection.execute(
            text("SELECT COUNT(*) FROM device_events")
        ).scalar_one()
    return DeviceEventList(
        items=[DeviceEvent.model_validate(_device_event_from_row(row)) for row in rows],
        total=total,
    )


@app.post("/api/events", response_model=Event, status_code=status.HTTP_201_CREATED)
def create_event(event: EventCreate) -> Event:
    with connect() as connection:
        result = connection.execute(
            events.insert()
            .values(
                latitude=event.latitude,
                longitude=event.longitude,
                severity=event.severity,
                timestamp=event.timestamp,
                event_type=event.event_type,
                simulated=event.simulated,
            )
            .returning(events.c.id)
        )
        row = connection.execute(
            text("SELECT * FROM events WHERE id = :event_id"),
            {"event_id": result.scalar_one()},
        ).mappings().one()
    return Event.model_validate(event_from_row(row))


@app.get("/api/events", response_model=EventList)
def list_events(
    severity: Annotated[Severity | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> EventList:
    with connect() as connection:
        rows = connection.execute(
            text("""
            SELECT * FROM events
            WHERE (:severity IS NULL OR severity = :severity)
            ORDER BY timestamp DESC, id DESC
            LIMIT :limit
            """),
            {"severity": severity, "limit": limit},
        ).mappings().all()
        total = connection.execute(
            text(
                "SELECT COUNT(*) FROM events "
                "WHERE (:severity IS NULL OR severity = :severity)"
            ),
            {"severity": severity},
        ).scalar_one()
    return EventList(
        items=[Event.model_validate(event_from_row(row)) for row in rows],
        total=total,
    )


@app.get("/api/events/{event_id}", response_model=Event)
def get_event(event_id: int) -> Event:
    with connect() as connection:
        row = connection.execute(
            text("SELECT * FROM events WHERE id = :event_id"),
            {"event_id": event_id},
        ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return Event.model_validate(event_from_row(row))


@app.delete("/api/events/simulated", status_code=status.HTTP_204_NO_CONTENT)
def clear_simulated_events() -> Response:
    with connect() as connection:
        connection.execute(text("DELETE FROM events WHERE simulated = true"))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
