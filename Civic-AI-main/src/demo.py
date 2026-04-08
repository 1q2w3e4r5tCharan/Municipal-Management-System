"""Simple demo that POSTs a few sample reports to the local API.

Run after starting the server:
    python -m src.demo
"""
import requests
import os
from pathlib import Path

API = os.environ.get("AI_CIVIC_API", "http://127.0.0.1:8000")


def post_sample(description: str, image_path: str = None):
    files = {}
    data = {"description": description}
    if image_path and Path(image_path).exists():
        files["image"] = open(image_path, "rb")
    r = requests.post(f"{API}/report", data=data, files=files)
    print(r.status_code)
    print(r.json())


def main():
    print("Posting sample reports to", API)
    post_sample("There's a large pothole near the intersection, causing danger for cyclists.")
    post_sample("Street light is out on 5th Avenue", None)


if __name__ == "__main__":
    main()
