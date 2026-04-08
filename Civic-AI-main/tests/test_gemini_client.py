import io
from fastapi.testclient import TestClient
from src.app import app
from src import gemini_client
from PIL import Image

client = TestClient(app)


def test_analyze_text_local():
    res = gemini_client.analyze_text("There is a pothole on the main road")
    assert isinstance(res, dict)
    assert 'label' in res and 'confidence' in res and 'source' in res
    assert isinstance(res['confidence'], float)


def test_ai_analyze_endpoint_image():
    # Create a small red image in memory
    img = Image.new('RGB', (100, 100), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    buf.seek(0)

    files = {'image': ('red.jpg', buf, 'image/jpeg')}
    resp = client.post('/ai/analyze', files=files)
    assert resp.status_code == 200
    body = resp.json()
    assert 'analysis' in body
    assert 'label' in body['analysis']
