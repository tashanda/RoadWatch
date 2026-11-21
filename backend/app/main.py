from fastapi import FastAPI

app = FastAPI(title="RoadWatch API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
