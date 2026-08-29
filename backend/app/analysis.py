"""Structural analysis of an uploaded presentation using python-pptx."""

from __future__ import annotations

from typing import IO, Any

from pptx import Presentation
from pptx.util import Emu

EMU_PER_POINT = 12700


def _slide_title(slide: Any) -> str | None:
    try:
        if slide.shapes.title is not None and slide.shapes.title.has_text_frame:
            text = slide.shapes.title.text_frame.text.strip()
            return text or None
    except (AttributeError, ValueError):
        pass
    for shape in slide.shapes:
        if getattr(shape, "has_text_frame", False):
            text = shape.text_frame.text.strip()
            if text:
                return text.splitlines()[0][:120]
    return None


def _notes(slide: Any) -> str | None:
    if not slide.has_notes_slide:
        return None
    text = slide.notes_slide.notes_text_frame.text.strip()
    return text or None


def analyse_presentation(stream: IO[bytes]) -> dict[str, Any]:
    """Return slide count, native dimensions and per-slide metadata."""
    presentation = Presentation(stream)
    width = Emu(presentation.slide_width or 0) / EMU_PER_POINT
    height = Emu(presentation.slide_height or 0) / EMU_PER_POINT

    slides = [
        {
            "index": index,
            "title": _slide_title(slide),
            "shape_count": len(slide.shapes),
            "notes": _notes(slide),
        }
        for index, slide in enumerate(presentation.slides)
    ]

    return {
        "slide_count": len(slides),
        "width_points": round(float(width), 2),
        "height_points": round(float(height), 2),
        "aspect_ratio": round(float(width) / float(height), 4) if height else 1.7778,
        "slides": slides,
    }
