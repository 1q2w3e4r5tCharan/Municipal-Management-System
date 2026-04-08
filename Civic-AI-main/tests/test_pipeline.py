import io
from fastapi.testclient import TestClient
from src.app import app
from src.classifier import classify_text, classify_image
from src.score import compute_priority
from src import db


client = TestClient(app)

# ensure DB is initialized and empty before tests
db.init_db()
db.clear_tickets()


def test_text_classifier_keywords():
    label, conf, meta = classify_text("There is a pothole on Main St")
    assert label == "pothole"
    assert conf >= 0.8


def test_priority_computation():
    p = compute_priority("flooding", 0.9, text="urgent: water in basement", image_meta={"avg_brightness": 120})
    assert p > 0.8


def test_api_report_without_image():
    resp = client.post("/report", data={"description": "Pothole near park"})
    assert resp.status_code == 200
    body = resp.json()
    assert "id" in body
    assert body["label"] in ["pothole", "other"]


def test_api_report_with_dummy_image():
    # Create a small red image in memory
    from PIL import Image

    img = Image.new("RGB", (200, 200), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    files = {"image": ("red.jpg", buf, "image/jpeg")}
    resp = client.post("/report", data={"description": "graffiti on wall"}, files=files)
    assert resp.status_code == 200
    body = resp.json()
    assert "priority" in body
