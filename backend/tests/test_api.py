from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ROADWATCH_DB_PATH", str(tmp_path / "test.db"))
    with TestClient(app) as test_client:
        yield test_client


def valid_event(**overrides):
    event = {
        "latitude": 27.9506,
        "longitude": -82.4572,
        "severity": "medium",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": "pothole",
    }
    event.update(overrides)
    return event


def test_health_and_event_lifecycle(client):
    assert client.get("/health").json() == {"status": "ok"}

    created_response = client.post("/api/events", json=valid_event())
    assert created_response.status_code == 201
    created = created_response.json()

    assert client.get(f"/api/events/{created['id']}").json()["id"] == created["id"]
    listing = client.get("/api/events").json()
    assert listing["total"] == 1
    assert listing["items"][0]["latitude"] == 27.9506


@pytest.mark.parametrize(
    "overrides",
    [
        {"latitude": 91},
        {"longitude": -181},
        {"severity": "urgent"},
        {"event_type": "crater"},
        {"timestamp": "not-a-timestamp"},
        {"timestamp": "2026-01-01T10:00:00"},
        {"timestamp": "2099-01-01T10:00:00Z"},
    ],
)
def test_rejects_invalid_events(client, overrides):
    assert client.post("/api/events", json=valid_event(**overrides)).status_code == 422


def test_severity_filter_and_clear_simulated_events(client):
    client.post("/api/events", json=valid_event(severity="high", simulated=True))
    client.post("/api/events", json=valid_event(severity="low", simulated=False))

    assert client.get("/api/events", params={"severity": "high"}).json()["total"] == 1
    assert client.delete("/api/events/simulated").status_code == 204
    remaining = client.get("/api/events").json()
    assert remaining["total"] == 1
    assert remaining["items"][0]["simulated"] is False


def test_unknown_event_returns_404(client):
    assert client.get("/api/events/9999").status_code == 404


def test_seed_requires_explicit_development_environment(monkeypatch):
    from scripts import seed_simulated

    monkeypatch.delenv("ROADWATCH_ENV", raising=False)
    with pytest.raises(SystemExit, match="Refusing to seed"):
        seed_simulated.main()


@pytest.mark.parametrize(
    ("configured_url", "expected_url"),
    [
        ("postgres://user:pass@db.example/roadwatch", "postgresql+psycopg://"),
        ("postgresql://user:pass@db.example/roadwatch", "postgresql+psycopg://"),
        ("postgresql+psycopg://user:pass@db.example/roadwatch", "postgresql+psycopg://"),
    ],
)
def test_database_url_supports_postgresql_driver(
    monkeypatch, configured_url, expected_url
):
    from app.database import database_url

    monkeypatch.setenv("DATABASE_URL", configured_url)
    assert database_url().startswith(expected_url)
