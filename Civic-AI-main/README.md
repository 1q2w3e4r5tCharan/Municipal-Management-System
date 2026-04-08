# AI Civic Agent — Prototype

[![CI](.github/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)

Prototype of an agentic AI pipeline to triage citizen reports (images + text), classify issue type, compute a priority score, and route tickets to the appropriate department.

This is a minimal, local prototype intended as a foundation you can extend by plugging real CV/NLP models and integrating with municipal ticketing systems.

Quick start (Windows PowerShell):

1. Create a virtual environment and install deps

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1; python -m pip install -r requirements.txt
```

2. Run the API

```powershell
uvicorn src.app:app --reload
```

3. Send a demo report (in a new shell)

```powershell
python -m src.demo
```

Files:
- `src/app.py` — FastAPI app exposing `/report` and `/ticket/{id}` endpoints.
- `src/classifier.py` — Modular classifier stubs (image/text) with hooks to plug real models.
- `src/score.py` — Priority scoring logic.
- `src/router.py` — Department mapping rules.
- `src/demo.py` — Script that POSTs sample reports to the running API.
- `tests/test_pipeline.py` — Unit tests for core components and API.

Next steps:
- Replace `classifier` stubs with a trained CV model (e.g., MobileNet or Detectron) and NLP model (BERT) for improved accuracy.
- Add persistent database and authentication, integrate with city ticketing (e.g., ServiceNow) and volunteer group dispatch.
- Add telemetry, auditing, and human-in-the-loop review interface for uncertain predictions.

Notifications (email)
---------------------

This prototype supports sending email notifications for new tickets and ticket updates. It uses a simple SMTP-based sender and reads configuration from environment variables. The following environment variables are supported:

- `SMTP_HOST` - SMTP server hostname (required to send emails)
- `SMTP_PORT` - SMTP server port (required to send emails)
- `SMTP_USER` - SMTP username (optional)
- `SMTP_PASS` - SMTP password (optional)
- `SMTP_USE_TLS` - 'true' (default) to use STARTTLS, or 'false' to skip TLS
- `FROM_EMAIL` - From address used for outgoing messages (defaults to `no-reply@example.com`)
- `PUBLIC_NOTIFICATION_LIST` - optional comma-separated list of addresses to CC for public notifications

When these are set, the API will attempt to email the department address (looked up from `src/departments.py`) and the public list on ticket creation and updates. In development, if SMTP variables are not set the system will log that it did not send emails.

Optional model integration
--------------------------

If you want to try a real model locally, there's an optional example in `src/classifier_tf.py` that shows how to use TensorFlow's MobileNetV2. This is only a demo — for best results you should train or fine-tune a model on civic issue images.

To enable it:

```powershell
# install tensorflow (optional, not required for tests)
python -m pip install tensorflow
```

The main `src/classifier` will automatically use the TensorFlow classifier when available and fall back to the lightweight heuristics otherwise.

Docker
------

A `Dockerfile` is provided to build a container image for the API. To build locally:

```powershell
docker build -t ai-civic-agent:latest .

# optionally run it
docker run --rm -p 8000:8000 ai-civic-agent:latest
```

CI
--

A GitHub Actions workflow is included at `.github/workflows/ci.yml` that runs tests on push/PR across multiple OSes. The workflow also builds a Docker image and uploads it as an artifact (no registry push).

