import os
import json
import base64
import requests
from typing import Optional, Dict, Any

from .classifier import classify_text, classify_image

# Attempt to use Google ADC (OAuth) when available
try:
    import google.auth
    from google.auth.transport.requests import Request as GARequest
    _HAS_GOOGLE_AUTH = True
except Exception:
    _HAS_GOOGLE_AUTH = False

# Simple Gemini / Generative Language API client helper
# - If GEMINI_API_KEY is set, attempts to call the (REST) Generative Language endpoint
# - If not available or the call fails, falls back to local classifiers in `classifier.py`


def _get_api_key() -> Optional[str]:
    return os.environ.get('GEMINI_API_KEY')


def _get_model() -> str:
    # Default to a stable text model; override with GEMINI_MODEL env var
    return os.environ.get('GEMINI_MODEL', 'text-bison-001')


def analyze_text(text: str, timeout: float = 6.0) -> Dict[str, Any]:
    """
    Analyze text using Gemini/Generative Language API when available.

    Returns a dict with at least: {
      'label': str,
      'confidence': float,
      'explanation': str,
      'source': 'gemini'|'local'|'fallback'
    }

    If the API key is not set or the remote call fails, this will fall back to the
    local `classify_text` function and package its output.
    """
    api_key = _get_api_key()
    if not text:
        return {"label": "other", "confidence": 0.2, "explanation": "no_text", "source": "local"}

    # Try remote call when API key is present
    if api_key:
        try:
            model = _get_model()
            # We use the REST generate endpoint pattern. Some deployments require OAuth
            # instead of an API key and model names vary; using env var GEMINI_MODEL helps.
            url = f"https://generativelanguage.googleapis.com/v1beta2/models/{model}:generate?key={api_key}"
            prompt = (
                "You are a municipal issue classifier. Given the user's text, pick one label and a confidence.\n"
                "Return ONLY a JSON object with keys: label (one of pothole, street_light, graffiti, flooding, trash, sidewalk_damage, other),\n"
                "confidence (0.0-1.0), explanation (short plain text).\n\n"
                f"User text: {text}"
            )
            body = {
                "prompt": {"text": prompt},
                "temperature": 0.0,
                "maxOutputTokens": 256,
            }
            headers = {"Content-Type": "application/json"}
            resp = requests.post(url, json=body, headers=headers, timeout=timeout)
            if resp.ok:
                data = resp.json()
                text_out = None
                if 'candidates' in data and isinstance(data['candidates'], list) and data['candidates']:
                    text_out = data['candidates'][0].get('content')
                elif 'output' in data and isinstance(data['output'], list) and data['output']:
                    text_out = data['output'][0].get('content')
                elif 'responses' in data and isinstance(data['responses'], list) and data['responses']:
                    text_out = data['responses'][0]
                # try to parse JSON
                if text_out:
                    try:
                        parsed = json.loads(text_out.strip())
                        label = parsed.get('label') or 'other'
                        confidence = float(parsed.get('confidence', 0.0))
                        explanation = parsed.get('explanation', '')
                        return {"label": label, "confidence": max(0.0, min(0.99, confidence)), "explanation": explanation, "source": "gemini"}
                    except Exception:
                        # model may have returned plain text — attempt to extract label heuristically
                        txtl = str(text_out).lower()
                        for lab in ["pothole","street_light","graffiti","flooding","trash","sidewalk_damage","other"]:
                            if lab.replace('_',' ') in txtl or lab in txtl:
                                return {"label": lab, "confidence": 0.8, "explanation": text_out, "source": "gemini_heuristic"}
        except Exception:
            # Any error -> fall back to local classifier below
            pass

        # If no API key or previous call failed, try OAuth-based ADC (service account) if available
        if _HAS_GOOGLE_AUTH:
            try:
                model = _get_model()
                url = f"https://generativelanguage.googleapis.com/v1beta2/models/{model}:generate"
                prompt = (
                    "You are a municipal issue classifier. Given the user's text, pick one label and a confidence.\n"
                    "Return ONLY a JSON object with keys: label (one of pothole, street_light, graffiti, flooding, trash, sidewalk_damage, other),\n"
                    "confidence (0.0-1.0), explanation (short plain text).\n\n"
                    f"User text: {text}"
                )
                body = {"prompt": {"text": prompt}, "temperature": 0.0, "maxOutputTokens": 256}
                # Obtain credentials via Application Default Credentials and refresh to get bearer token
                creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
                if not creds.valid:
                    creds.refresh(GARequest())
                token = getattr(creds, 'token', None)
                if token:
                    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
                    resp = requests.post(url, json=body, headers=headers, timeout=timeout)
                    if resp.ok:
                        data = resp.json()
                        text_out = None
                        if 'candidates' in data and isinstance(data['candidates'], list) and data['candidates']:
                            text_out = data['candidates'][0].get('content')
                        elif 'output' in data and isinstance(data['output'], list) and data['output']:
                            text_out = data['output'][0].get('content')
                        elif 'responses' in data and isinstance(data['responses'], list) and data['responses']:
                            text_out = data['responses'][0]
                        if text_out:
                            try:
                                parsed = json.loads(text_out.strip())
                                label = parsed.get('label') or 'other'
                                confidence = float(parsed.get('confidence', 0.0))
                                explanation = parsed.get('explanation', '')
                                return {"label": label, "confidence": max(0.0, min(0.99, confidence)), "explanation": explanation, "source": "gemini"}
                            except Exception:
                                txtl = str(text_out).lower()
                                for lab in ["pothole","street_light","graffiti","flooding","trash","sidewalk_damage","other"]:
                                    if lab.replace('_',' ') in txtl or lab in txtl:
                                        return {"label": lab, "confidence": 0.8, "explanation": text_out, "source": "gemini_heuristic"}
            except Exception:
                pass

    # Fallback: local classifier
    try:
        label, conf, meta = classify_text(text)
        explanation = meta.get('matched') or meta.get('reason') or meta.get('source') or ''
        return {"label": label, "confidence": conf, "explanation": explanation, "source": "local"}
    except Exception:
        return {"label": "other", "confidence": 0.2, "explanation": "classification_failed", "source": "fallback"}


def analyze_image(image_bytes: bytes, timeout: float = 8.0) -> Dict[str, Any]:
    """
    Analyze an image. If GEMINI multimodal model is available and configured to accept images
    this function could be extended to call it. For now we attempt a best-effort text-based
    analysis by describing the image as base64 inline to the model; if that is not supported
    the function falls back to the local `classify_image` implementation.

    Returns dict similar to analyze_text.
    """
    api_key = _get_api_key()
    if not image_bytes:
        return {"label": "other", "confidence": 0.2, "explanation": "no_image", "source": "local"}

    # base64 snippet (avoid including very large data in prompt; include a short prefix only)
    try:
        b64 = base64.b64encode(image_bytes[:20000]).decode('ascii')
    except Exception:
        b64 = ''

    if api_key:
        try:
            model = _get_model()
            url = f"https://generativelanguage.googleapis.com/v1beta2/models/{model}:generate?key={api_key}"
            prompt = (
                "You are an assistant that classifies municipal issues from images. The image is provided as base64 (partial) below.\n"
                "If you cannot interpret base64, say so. Return ONLY JSON {label, confidence, explanation}.\n\n"
                f"Image base64_prefix: {b64}\n"
            )
            body = {"prompt": {"text": prompt}, "temperature": 0.0, "maxOutputTokens": 256}
            headers = {"Content-Type": "application/json"}
            resp = requests.post(url, json=body, headers=headers, timeout=timeout)
            if resp.ok:
                data = resp.json()
                text_out = None
                if 'candidates' in data and isinstance(data['candidates'], list) and data['candidates']:
                    text_out = data['candidates'][0].get('content')
                elif 'output' in data and isinstance(data['output'], list) and data['output']:
                    text_out = data['output'][0].get('content')
                if text_out:
                    try:
                        parsed = json.loads(text_out.strip())
                        label = parsed.get('label') or 'other'
                        confidence = float(parsed.get('confidence', 0.0))
                        explanation = parsed.get('explanation', '')
                        return {"label": label, "confidence": max(0.0, min(0.99, confidence)), "explanation": explanation, "source": "gemini"}
                    except Exception:
                        txtl = str(text_out).lower()
                        for lab in ["pothole","street_light","graffiti","flooding","trash","sidewalk_damage","other"]:
                            if lab.replace('_',' ') in txtl or lab in txtl:
                                return {"label": lab, "confidence": 0.7, "explanation": text_out, "source": "gemini_heuristic"}
        except Exception:
            pass

    # Try OAuth-based ADC for image analysis if available
    if _HAS_GOOGLE_AUTH:
        try:
            model = _get_model()
            url = f"https://generativelanguage.googleapis.com/v1beta2/models/{model}:generate"
            prompt = (
                "You are an assistant that classifies municipal issues from images. The image is provided as base64 (partial) below.\n"
                "If you cannot interpret base64, say so. Return ONLY JSON {label, confidence, explanation}.\n\n"
                f"Image base64_prefix: {b64}\n"
            )
            body = {"prompt": {"text": prompt}, "temperature": 0.0, "maxOutputTokens": 256}
            creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            if not creds.valid:
                creds.refresh(GARequest())
            token = getattr(creds, 'token', None)
            if token:
                headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
                resp = requests.post(url, json=body, headers=headers, timeout=timeout)
                if resp.ok:
                    data = resp.json()
                    text_out = None
                    if 'candidates' in data and isinstance(data['candidates'], list) and data['candidates']:
                        text_out = data['candidates'][0].get('content')
                    elif 'output' in data and isinstance(data['output'], list) and data['output']:
                        text_out = data['output'][0].get('content')
                    if text_out:
                        try:
                            parsed = json.loads(text_out.strip())
                            label = parsed.get('label') or 'other'
                            confidence = float(parsed.get('confidence', 0.0))
                            explanation = parsed.get('explanation', '')
                            return {"label": label, "confidence": max(0.0, min(0.99, confidence)), "explanation": explanation, "source": "gemini"}
                        except Exception:
                            txtl = str(text_out).lower()
                            for lab in ["pothole","street_light","graffiti","flooding","trash","sidewalk_damage","other"]:
                                if lab.replace('_',' ') in txtl or lab in txtl:
                                    return {"label": lab, "confidence": 0.7, "explanation": text_out, "source": "gemini_heuristic"}
        except Exception:
            pass

    # Fallback to local image classifier
    try:
        label, conf, meta = classify_image(image_bytes)
        explanation = json.dumps(meta)
        return {"label": label, "confidence": conf, "explanation": explanation, "source": "local"}
    except Exception:
        return {"label": "other", "confidence": 0.2, "explanation": "classification_failed", "source": "fallback"}
