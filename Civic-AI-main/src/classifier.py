from typing import Tuple, Dict
from PIL import Image, ImageFilter
import io
import math
import os
import json
import requests

# Try to use optional TensorFlow-based classifier if available
try:
    from .classifier_tf import classify_image_tf  # type: ignore
    _HAS_TF_CLASSIFIER = True
except Exception:
    _HAS_TF_CLASSIFIER = False

# Labels our prototype supports
LABELS = [
    "pothole",
    "street_light",
    "graffiti",
    "fallen_tree",
    "flooding",
    "trash",
    "sidewalk_damage",
    "other",
]


def load_image(image_bytes: bytes) -> Image.Image:
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


def classify_image(image_bytes: bytes) -> Tuple[str, float, Dict]:
    """
    Very small heuristic image classifier for the prototype.

    Returns (label, confidence, metadata)

    Notes:
    - This is a placeholder. Replace with a proper model by implementing
      load_model() and model_predict(image) and returning the same tuple.
    """
    # If TensorFlow classifier is available, delegate to it (prefer real model)
    if _HAS_TF_CLASSIFIER:
        try:
            return classify_image_tf(image_bytes)
        except Exception:
            # fall back to heuristic
            pass

    try:
        img = load_image(image_bytes)
    except Exception:
        return "other", 0.2, {"reason": "invalid_image"}

    w, h = img.size
    aspect = w / (h + 1e-6)
    pixels = img.getdata()
    # compute average brightness
    avg = sum((r + g + b) / 3 for (r, g, b) in pixels) / (w * h)

    # Heuristics (toy rules):
    # - dark, uneven surfaces -> pothole
    # - tall thin vertical bright -> street_light
    # - lots of colorful high-frequency -> graffiti
    # - large saturated bluish -> flooding

    # simple color statistics
    r_mean = sum(p[0] for p in pixels) / (w * h)
    g_mean = sum(p[1] for p in pixels) / (w * h)
    b_mean = sum(p[2] for p in pixels) / (w * h)

    # heuristic scores
    scores = {label: 0.01 for label in LABELS}

    if avg < 80 and w > 100 and h > 100:
        scores["pothole"] += 0.6

    # center-darkness heuristic: many pothole photos have a dark depressed center
    try:
        cx0 = int(w * 0.3)
        cy0 = int(h * 0.3)
        cx1 = int(w * 0.7)
        cy1 = int(h * 0.7)
        # compute mean brightness in center crop
        center_pixels = []
        for y in range(cy0, cy1):
            for x in range(cx0, cx1):
                r, g, b = img.getpixel((x, y))
                center_pixels.append((r + g + b) / 3)
        if center_pixels:
            center_avg = sum(center_pixels) / len(center_pixels)
        else:
            center_avg = avg
        # if the center is noticeably darker than the overall image, boost pothole
        if center_avg < 95 and avg < 130 and (avg - center_avg) > 15:
            scores["pothole"] += 0.5
    except Exception:
        center_avg = None

    # bright thin (lamp post) heuristic via aspect ratio
    if aspect < 0.4 or aspect > 2.5:
        scores["street_light"] += 0.4

    # graffiti: colorful images with high saturation and high-frequency detail (painted walls)
    # Avoid flagging colorful UI screenshots by requiring both color variation and edge density.
    # Prepare defaults for extra stats
    channel_var = (abs(r_mean - g_mean) + abs(r_mean - b_mean) + abs(g_mean - b_mean))
    s_mean = None
    edge_density = None
    brightness_std = None
    is_ui_like = False

    try:
        # compute mean saturation from HSV representation
        hsv = img.convert('HSV')
        s_vals = [p[1] for p in hsv.getdata()]
        s_mean = sum(s_vals) / (w * h)

        # approximate edge density using PIL's FIND_EDGES filter
        gray = img.convert('L')
        edges = gray.filter(ImageFilter.FIND_EDGES)
        edge_pixels = sum(1 for px in edges.getdata() if px > 20)
        edge_density = edge_pixels / (w * h)

        # brightness standard deviation (approx)
        brightness_vals = [ (r+g+b)/3 for (r,g,b) in pixels ]
        mean_b = avg
        brightness_var = sum((v - mean_b) ** 2 for v in brightness_vals) / (w * h)
        brightness_std = math.sqrt(brightness_var)

        # lightweight UI-like detection: screenshots often are bright, low-contrast
        # and have relatively low true photographic edge density
        if avg > 160 and (brightness_std is not None and brightness_std < 30) and (edge_density is not None and edge_density < 0.03):
            is_ui_like = True

        # graffiti: require multiple signals (size, color variation, saturation, edges)
        if not is_ui_like and w * h > 30000 and channel_var > 40 and (s_mean is not None and s_mean > 35) and (edge_density is not None and edge_density > 0.015):
            scores["graffiti"] += 0.6
        else:
            # if UI-like, reduce graffiti score slightly to avoid false positives
            if is_ui_like:
                scores["graffiti"] = max(0.01, scores["graffiti"] - 0.45)
    except Exception:
        # fallback: if any of the above fails, use channel variance fallback
        if channel_var > 45 and w * h > 20000:
            scores["graffiti"] += 0.4

    # flooding: bluish and brighter
    if b_mean > r_mean + 10 and b_mean > g_mean + 10 and avg > 100:
        scores["flooding"] += 0.5

    # fallen tree / large vegetation obstruction heuristic:
    # - image with significant green area (foliage) plus some brown trunk pixels
    # - moderate to high edge density and reasonably large size
    try:
        # proportion of strong-green pixels
        green_pixels = sum(1 for (r, g, b) in pixels if (g > r + 15 and g > b + 15 and g > 70))
        green_ratio = green_pixels / (w * h)
        # crude brown/trunk detector: r relatively high, g moderate, b low
        brown_pixels = sum(1 for (r, g, b) in pixels if (r > 80 and g > 40 and b < g))
        brown_ratio = brown_pixels / (w * h)
        if w * h > 20000 and green_ratio > 0.12 and brown_ratio > 0.01 and (edge_density is not None and edge_density > 0.01):
            scores["fallen_tree"] += 0.7
    except Exception:
        green_ratio = None
        brown_ratio = None

    # trash: lots of small objects — approximated by high edge count stub (skip real edges for speed)
    # fallback: sidewalk damage for medium brightness, small irregular images
    if 80 <= avg <= 140:
        scores["sidewalk_damage"] += 0.2

    # choose best
    label = max(scores, key=scores.get)
    confidence = min(0.99, max(0.3, scores[label]))

    metadata = {
        "width": w,
        "height": h,
        "avg_brightness": avg,
        "r_mean": r_mean,
        "g_mean": g_mean,
        "b_mean": b_mean,
        "channel_var": channel_var,
        "s_mean": s_mean,
        "edge_density": edge_density,
        "brightness_std": brightness_std,
        "is_ui_like": is_ui_like,
        "center_avg": center_avg,
        "green_ratio": green_ratio,
        "brown_ratio": brown_ratio,
    }
    return label, float(confidence), metadata


def classify_text(text: str) -> Tuple[str, float, Dict]:
    """
    Naive text classifier that looks for keywords.
    Returns (label, confidence, metadata)
    """
    if not text:
        return "other", 0.2, {"reason": "no_text"}

    t = text.lower()

    # If a Gemini/Generative API key is present in the environment, try using it
    # to get a more robust classification. If the call fails for any reason,
    # fall back to the local keyword classifier.
    api_key = os.environ.get('GEMINI_API_KEY')
    if api_key:
        try:
            prompt = (
                "You are a municipal issue classifier. Given the user text, choose one label "
                "from: pothole, street_light, graffiti, flooding, trash, sidewalk_damage, other. "
                "Respond only with a JSON object: {\"label\": \"...\", \"confidence\": 0.0}. \n\n"
                f"Text: {text}"
            )
            # Endpoint (Generative Language API). This code attempts the REST endpoint
            # using an API key. In some deployments you may prefer OAuth2 bearer tokens.
            url = f"https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generate?key={api_key}"
            body = {
                "prompt": {"text": prompt},
                "temperature": 0.0,
                "maxOutputTokens": 256
            }
            headers = {"Content-Type": "application/json"}
            resp = requests.post(url, headers=headers, json=body, timeout=6)
            if resp.ok:
                # The response format varies by API version; attempt to extract text
                data = resp.json()
                # Try common fields used by the API
                text_out = None
                if 'candidates' in data and isinstance(data['candidates'], list) and len(data['candidates'])>0:
                    text_out = data['candidates'][0].get('content')
                elif 'output' in data and isinstance(data['output'], list) and len(data['output'])>0:
                    text_out = data['output'][0].get('content')
                elif 'responses' in data and isinstance(data['responses'], list) and len(data['responses'])>0:
                    text_out = data['responses'][0]
                elif 'result' in data and isinstance(data['result'], dict):
                    text_out = json.dumps(data['result'])

                if text_out:
                    # try to parse JSON from the model's reply
                    try:
                        parsed = json.loads(text_out.strip())
                        label = parsed.get('label')
                        conf = float(parsed.get('confidence', 0.0))
                        if label:
                            return label, max(0.0, min(0.99, conf)), {"source": "gemini"}
                    except Exception:
                        # fallback: simple parsing heuristics
                        txtl = text_out.lower()
                        for lab in LABELS:
                            if lab.replace('_', ' ') in txtl or lab in txtl:
                                return lab, 0.8, {"source": "gemini_heuristic"}
        except Exception:
            # network errors, timeouts, malformed responses, etc. — fall through to keyword classifier
            pass
    keywords = {
        "pothole": ["pothole", "hole in road", "sinkhole"],
        "street_light": ["light out", "streetlight", "lamp post", "light not working"],
        "graffiti": ["graffiti", "spray paint", "tagging"],
        "flooding": ["flood", "standing water", "water on road", "waterlogging", "water log", "nala", "drain"],
        # 'nala' is commonly used locally for drains/streams
        "trash": ["trash", "garbage", "dumped", "litter", "dumping", "solid waste"],
        "sidewalk_damage": ["sidewalk", "cracked", "trip", "uneven"],
    }

    for label, kws in keywords.items():
        for kw in kws:
            if kw in t:
                return label, 0.9, {"matched": kw}

    # urgent signals
    urgent_words = ["injury", "danger", "urgent", "emergency", "blocked"]
    for uw in urgent_words:
        if uw in t:
            return "other", 0.8, {"matched": uw}

    # Local language / regional keywords (simple additions)
    local_kw = ["municipal", "municipal corporation", "nala", "sewage", "waterlogging", "storm drain", "nh", "road not" ]
    for lk in local_kw:
        if lk in t:
            # promote flooding/trash depending on token
            if 'nala' in lk or 'drain' in lk or 'water' in lk:
                return 'flooding', 0.75, {'matched': lk}
            return 'other', 0.6, {'matched': lk}

    return "other", 0.3, {}


def load_model():
    """
    Placeholder for loading a CV model. Example (commented):

    # from tensorflow.keras.applications.mobilenet_v2 import MobileNetV2
    # model = MobileNetV2(weights='imagenet')
    # return model

    Currently returns None. Implement this when adding real models.
    """
    return None
