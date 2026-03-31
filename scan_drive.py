#!/usr/bin/env python3
"""
scan_drive.py — Scan the Physics Resources Google Drive folder and generate
a filename → Drive preview URL map, saved as drive_resources.json.

Usage:
  python scan_drive.py
"""
import json
import os
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ["GOOGLE_DRIVE_API_KEY"]
FOLDER_ID = "1aTrc-0PwrZRtqcq6cjRwJ0tBH8FeG4JC"
OUTPUT = Path(__file__).parent / "drive_resources.json"


def list_all_files(folder_id: str) -> list[dict]:
    """Recursively list all files in a Drive folder."""
    files = []
    page_token = None

    while True:
        params = {
            "key": API_KEY,
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken, files(id, name, mimeType)",
            "pageSize": 1000,
        }
        if page_token:
            params["pageToken"] = page_token

        resp = requests.get(
            "https://www.googleapis.com/drive/v3/files",
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()

        for item in data.get("files", []):
            if item["mimeType"] == "application/vnd.google-apps.folder":
                # Recurse into subfolders
                files.extend(list_all_files(item["id"]))
            else:
                files.append(item)

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return files


def main():
    print(f"Scanning Drive folder {FOLDER_ID}...")
    files = list_all_files(FOLDER_ID)
    print(f"Found {len(files)} files.")

    mapping = {}
    for f in files:
        name = f["name"]
        file_id = f["id"]
        preview_url = f"https://drive.google.com/file/d/{file_id}/preview"
        mapping[name] = preview_url
        print(f"  {name}")

    OUTPUT.write_text(json.dumps(mapping, indent=2, ensure_ascii=False))
    print(f"\nSaved to {OUTPUT}")


if __name__ == "__main__":
    main()
