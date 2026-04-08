"""
Optional TensorFlow-based classifier example.

This module demonstrates how to plug a real model (MobileNetV2) into the
pipeline. It's optional: the main `src.classifier` will try to import
`classify_image_tf` from here and use it if TensorFlow is installed.

To enable this, install TensorFlow in your environment (not required for the
prototype tests):

    python -m pip install tensorflow

Note: downloading weights occurs on first run and needs network access.
"""
import io
from typing import Tuple, Dict
from PIL import Image

try:
    import numpy as np
    from tensorflow.keras.applications.mobilenet_v2 import MobileNetV2, preprocess_input, decode_predictions
    from tensorflow.keras.preprocessing import image as keras_image
    _MODEL = MobileNetV2(weights="imagenet")
except Exception:
    _MODEL = None


def classify_image_tf(image_bytes: bytes) -> Tuple[str, float, Dict]:
    """
    Run MobileNetV2 on the input image and map ImageNet predictions to coarse labels.

    This is a simple example: a production pipeline would use a dedicated
    model fine-tuned for civic issues (potholes, street light, graffiti, etc.).
    """
    if _MODEL is None:
        raise RuntimeError("TensorFlow model not available. Install tensorflow to use this function.")

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img = img.resize((224, 224))
    x = keras_image.img_to_array(img)
    x = np.expand_dims(x, axis=0)
    x = preprocess_input(x)

    preds = _MODEL.predict(x)
    decoded = decode_predictions(preds, top=3)[0]

    # Map some ImageNet classes heuristically to our labels
    mapping = {
        "pothole": ["grille", "stone_wall"],
        "street_light": ["street_sign", "lampshade", "traffic_light"],
        "graffiti": ["wall", "mural"],
        "flooding": ["sea", "lake", "pond"],
        "trash": ["garbage_truck", "bin", "ashcan"],
    }

    # choose best mapped label
    for imagenet_id, label, conf in decoded:
        for our_label, keys in mapping.items():
            if any(k in label for k in keys):
                return our_label, float(conf), {"imagenet_label": label}

    # fallback to top prediction mapped to 'other'
    top_label = decoded[0][1]
    top_conf = float(decoded[0][2])
    return "other", top_conf, {"imagenet_label": top_label}
