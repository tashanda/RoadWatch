from datetime import datetime, timezone
from contextlib import contextmanager
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.exc import SQLAlchemyError

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app import main

    monkeypatch.setenv("ROADWATCH_DB_PATH", str(tmp_path / "reports.db"))
    monkeypatch.setenv("ROADWATCH_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_STORAGE_BUCKET", raising=False)
    monkeypatch.setenv("ROADWATCH_ENV", "development")
    main._report_submissions.clear()
    with TestClient(app) as test_client:
        yield test_client
    main._report_submissions.clear()


def image_bytes(image_format="PNG", exif=None):
    image = Image.new("RGB", (20, 20), color=(200, 30, 30))
    data = BytesIO()
    image.save(data, format=image_format, exif=exif or b"")
    return data.getvalue()


def valid_fields(**overrides):
    fields = {
        "latitude": "27.9506",
        "longitude": "-82.4572",
        "severity": "medium",
        "description": "Near the intersection.",
    }
    fields.update(overrides)
    return fields


def upload(client, payload=None, contents=None, filename="road.png", content_type="image/png"):
    return client.post(
        "/api/reports",
        data=payload or valid_fields(),
        files={"photo": (filename, contents if contents is not None else image_bytes(), content_type)},
    )


def test_report_upload_list_detail_and_photo_strip_exif(client):
    exif = Image.Exif()
    exif[270] = "private device detail"
    response = upload(
        client,
        contents=image_bytes("JPEG", exif),
        filename="phone-photo.jpg",
        content_type="image/jpeg",
    )
    assert response.status_code == 201
    report = response.json()
    assert report["source"] == "community"
    assert report["status"] == "unverified"
    assert report["severity"] == "medium"
    assert report["description"] == "Near the intersection."
    assert report["photo_url"] == f"/api/reports/{report['id']}/photo"

    assert client.get("/api/reports").json()["total"] == 1
    assert client.get(f"/api/reports/{report['id']}").json()["id"] == report["id"]
    photo = client.get(report["photo_url"])
    assert photo.status_code == 200
    assert photo.headers["content-type"] == "image/jpeg"
    stored = Image.open(BytesIO(photo.content))
    assert stored.format == "JPEG"
    assert not stored.getexif()


def test_report_accepts_webp_photo(client):
    response = upload(
        client,
        contents=image_bytes("WEBP"),
        filename="road.webp",
        content_type="image/webp",
    )
    assert response.status_code == 201
    assert client.get(response.json()["photo_url"]).status_code == 200


@pytest.mark.parametrize(
    ("fields", "image_kind", "content_type", "expected_status"),
    [
        ({"latitude": "91"}, "valid", "image/png", 422),
        ({"longitude": "-181"}, "valid", "image/png", 422),
        ({"severity": "urgent"}, "valid", "image/png", 422),
        ({"description": "x" * 501}, "valid", "image/png", 422),
        ({}, "invalid", "image/png", 415),
        ({}, "gif", "image/gif", 415),
        ({}, "oversize", "image/png", 413),
    ],
)
def test_report_validation_rejects_bad_fields_and_uploads(
    client, fields, image_kind, content_type, expected_status
):
    contents = {
        "valid": image_bytes(),
        "invalid": b"not an image",
        "gif": image_bytes("GIF"),
        "oversize": b"x" * (5 * 1024 * 1024 + 1),
    }[image_kind]
    response = upload(client, valid_fields(**fields), contents, content_type=content_type)
    assert response.status_code == expected_status
    assert client.get("/api/reports").json()["total"] == 0


def test_report_storage_failure_does_not_create_metadata(client, monkeypatch):
    from app import main

    async def fail_upload(_photo_key, _image_bytes):
        raise HTTPException(status_code=502, detail="storage unavailable")

    monkeypatch.setattr(main, "_store_photo", fail_upload)
    response = upload(client)
    assert response.status_code == 502
    assert client.get("/api/reports").json()["total"] == 0


def test_report_database_failure_removes_uploaded_photo(client, monkeypatch, tmp_path):
    from app import main

    @contextmanager
    def fail_database():
        raise SQLAlchemyError("database unavailable")
        yield

    monkeypatch.setattr(main, "connect", fail_database)
    response = upload(client)
    assert response.status_code == 503
    assert list((tmp_path / "uploads").iterdir()) == []


def test_report_rate_limit(client):
    for _ in range(5):
        assert upload(client).status_code == 201
    assert upload(client).status_code == 429


def test_device_event_ingestion_is_authenticated_and_idempotent(client, monkeypatch):
    monkeypatch.setenv("ROADWATCH_DEVICE_TOKEN", "test-device-token")
    payload = {
        "event_id": str(uuid4()),
        "device_id": "roadwatch-01",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "latitude": None,
        "longitude": None,
        "sensor_summary": "Acceleration candidate; GPS fix unavailable.",
        "severity": "medium",
        "event_type": "pothole",
        "impact_magnitude": 8.2,
        "source": "esp32_sensor",
        "status": "unverified",
    }
    assert client.post("/api/device-events", json=payload).status_code == 401
    headers = {"X-Device-Token": "test-device-token"}
    first = client.post("/api/device-events", json=payload, headers=headers)
    second = client.post("/api/device-events", json=payload, headers=headers)
    assert first.status_code == 202
    assert first.json()["duplicate"] is False
    assert first.json()["event"]["latitude"] is None
    assert first.json()["event"]["impact_magnitude"] == 8.2
    assert first.json()["event"]["source"] == "esp32_sensor"
    assert first.json()["event"]["status"] == "unverified"
    assert second.status_code == 202
    assert second.json()["duplicate"] is True
    assert client.get("/api/device-events").json()["total"] == 1


def test_device_event_id_cannot_be_reused_by_another_device(client, monkeypatch):
    monkeypatch.setenv("ROADWATCH_DEVICE_TOKEN", "test-device-token")
    payload = {
        "event_id": str(uuid4()),
        "device_id": "roadwatch-01",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sensor_summary": "candidate without GPS",
    }
    headers = {"X-Device-Token": "test-device-token"}
    assert client.post("/api/device-events", json=payload, headers=headers).status_code == 202
    payload["device_id"] = "roadwatch-02"
    response = client.post("/api/device-events", json=payload, headers=headers)
    assert response.status_code == 409


def test_device_event_rejects_partial_coordinates(client, monkeypatch):
    monkeypatch.setenv("ROADWATCH_DEVICE_TOKEN", "test-device-token")
    payload = {
        "event_id": str(uuid4()),
        "device_id": "roadwatch-01",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "latitude": 27.9,
        "sensor_summary": "candidate",
    }
    response = client.post(
        "/api/device-events",
        json=payload,
        headers={"X-Device-Token": "test-device-token"},
    )
    assert response.status_code == 422


def test_device_event_rejects_invalid_sensor_metadata(client, monkeypatch):
    monkeypatch.setenv("ROADWATCH_DEVICE_TOKEN", "test-device-token")
    payload = {
        "event_id": str(uuid4()),
        "device_id": "roadwatch-01",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sensor_summary": "candidate",
        "impact_magnitude": -1,
        "source": "unknown",
    }
    response = client.post(
        "/api/device-events",
        json=payload,
        headers={"X-Device-Token": "test-device-token"},
    )
    assert response.status_code == 422
