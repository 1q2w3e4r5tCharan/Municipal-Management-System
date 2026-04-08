from typing import Dict

BASE_PRIORITY = {
    "pothole": 0.7,
    "street_light": 0.5,
    "graffiti": 0.2,
    "flooding": 0.9,
    "trash": 0.2,
    "sidewalk_damage": 0.4,
    "other": 0.3,
}


def compute_priority(pred_label: str, pred_conf: float, text: str = "", image_meta: Dict = None) -> float:
    """Compute a priority score in [0,1].

    Logic:
    - Start with base priority for the label
    - Boost by model confidence
    - Boost if text includes urgent keywords
    - Boost for flooding and night-time (image darker)
    """
    image_meta = image_meta or {}
    base = BASE_PRIORITY.get(pred_label, 0.3)
    score = base * 0.6 + pred_conf * 0.4

    t = (text or "").lower()
    if any(k in t for k in ["injury", "danger", "urgent", "blocked", "accident"]):
        score += 0.2

    # flooding is higher priority
    if pred_label == "flooding":
        score += 0.15

    # darker images at night could indicate hazard for street_light or pothole
    avg = image_meta.get("avg_brightness")
    if avg is not None:
        if avg < 60:
            # dark -> increase priority for lighting/pothole
            if pred_label in ("street_light", "pothole"):
                score += 0.15

    # clamp
    score = max(0.0, min(1.0, score))
    return round(score, 3)
