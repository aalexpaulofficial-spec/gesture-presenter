# Presentation service

Standalone API for the presentation upload pipeline. Deploy on any Python-capable host.

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Endpoints:

- `GET /health` — liveness probe
- `POST /decks` — multipart upload of a `.ppt`/`.pptx` file, returns slide count, native slide
  dimensions, aspect ratio and per-slide metadata
- `GET /decks/{deck_id}` — re-read metadata for a stored deck
- `DELETE /decks/{deck_id}` — remove a stored deck

The uploaded file is never modified or replaced. The web client points at this service through the
`VITE_PRESENTATION_API_URL` environment variable; when it is unset the client analyses and renders
the deck locally in the browser.
