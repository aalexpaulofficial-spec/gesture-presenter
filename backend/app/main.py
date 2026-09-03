"""
Presentation service API.

Runs independently from the web client. It accepts an uploaded .ppt/.pptx file,
validates it, extracts structural metadata with python-pptx and returns the
information the presenter view needs. The uploaded file is always the source of
truth: nothing is redesigned and no sample deck is ever substituted.
"""

from __future__ import annotations

import io
import uuid
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from .analysis import analyse_presentation
from .storage import DeckStore

ALLOWED_SUFFIXES = (".ppt", ".pptx")
MAX_BYTES = 60 * 1024 * 1024

app = FastAPI(title="Presentation Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

store = DeckStore()


class TextElement(BaseModel):
    text: str
    left: float
    top: float
    width: float
    height: float

class SlideInfo(BaseModel):
    index: int
    title: str | None = None
    shape_count: int
    notes: str | None = None
    text_elements: list[TextElement] = []


class DeckResponse(BaseModel):
    deck_id: str
    file_name: str
    slide_count: int
    width_points: float
    height_points: float
    aspect_ratio: float
    slides: list[SlideInfo]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/decks", response_model=DeckResponse)
async def create_deck(file: UploadFile = File(...)) -> Any:
    name = file.filename or "presentation.pptx"
    if not name.lower().endswith(ALLOWED_SUFFIXES):
        raise HTTPException(status_code=415, detail="Please upload a .ppt or .pptx presentation.")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(payload) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="This presentation is larger than the current limit.")

    try:
        analysis = analyse_presentation(io.BytesIO(payload))
    except Exception as exc:  # noqa: BLE001 - surfaced as a friendly message
        raise HTTPException(
            status_code=422,
            detail="We couldn't read this presentation. Please try another file.",
        ) from exc

    deck_id = uuid.uuid4().hex
    store.put(deck_id, name=name, payload=payload)
    return {"deck_id": deck_id, "file_name": name, **analysis}


@app.get("/decks/{deck_id}", response_model=DeckResponse)
def get_deck(deck_id: str) -> Any:
    record = store.get(deck_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Presentation not found.")
    return {
        "deck_id": deck_id,
        "file_name": record.name,
        **analyse_presentation(io.BytesIO(record.payload)),
    }


@app.delete("/decks/{deck_id}", status_code=204, response_class=Response)
def delete_deck(deck_id: str) -> Response:
    store.delete(deck_id)
    return Response(status_code=204)
