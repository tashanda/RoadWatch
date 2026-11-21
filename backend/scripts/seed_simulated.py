import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import connect, initialize_database  # noqa: E402
from app.models import EventCreate  # noqa: E402
from app.main import create_event  # noqa: E402


SEED_EVENTS = [
    (27.9506, -82.4572, "high", "pothole", 8),
    (27.9564, -82.4481, "medium", "pothole", 42),
    (27.9437, -82.4698, "low", "pothole", 95),
    (27.9381, -82.4519, "high", "pothole", 160),
    (27.9652, -82.4627, "medium", "pothole", 270),
    (27.9278, -82.4753, "low", "pothole", 390),
    (27.9721, -82.4416, "high", "pothole", 570),
    (27.9344, -82.4358, "medium", "pothole", 810),
    (27.9591, -82.4812, "low", "pothole", 1080),
    (27.9203, -82.4512, "medium", "pothole", 1320),
]


def main() -> None:
    if os.getenv("ROADWATCH_ENV", "").lower() != "development":
        raise SystemExit(
            "Refusing to seed: set ROADWATCH_ENV=development to enable simulated data."
        )

    initialize_database()
    with connect() as connection:
        connection.execute(text("DELETE FROM events WHERE simulated = true"))

    now = datetime.now(timezone.utc)
    for latitude, longitude, severity, event_type, minutes_ago in SEED_EVENTS:
        create_event(
            EventCreate(
                latitude=latitude,
                longitude=longitude,
                severity=severity,
                timestamp=now - timedelta(minutes=minutes_ago),
                event_type=event_type,
                simulated=True,
            )
        )

    print(f"Seeded {len(SEED_EVENTS)} fictional Tampa detections (simulated=true).")


if __name__ == "__main__":
    main()
