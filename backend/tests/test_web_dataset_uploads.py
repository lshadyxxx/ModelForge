"""Opt-in Web-origin checks; run against disposable QA versions only."""
import json
import os
import uuid

import httpx
import pytest


@pytest.mark.skipif(not os.getenv("MF_TEST_WEB_URL"), reason="Web-origin acceptance is opt-in")
def test_dataset_create_and_append_accept_above_two_mib():
    sample = json.dumps({"messages": [
        {"role": "user", "content": "proxy-upload"},
        {"role": "assistant", "content": "verified"},
    ]}, separators=(",", ":")).encode() + bytes([10])
    data = sample * (3 * 1024**2 // len(sample) + 1)
    version_ids = []
    with httpx.Client(base_url=os.environ["MF_TEST_WEB_URL"].rstrip("/") + "/api/v1", timeout=120) as client:
        try:
            created = client.post("/datasets", params={"name": "qa-web-upload-" + uuid.uuid4().hex},
                                  content=data, headers={"Content-Type": "application/x-ndjson"})
            assert created.status_code == 201, created.text
            first = created.json()
            version_ids.append(first["id"])
            appended = client.post("/datasets/" + first["dataset_id"] + "/versions", content=data,
                                   headers={"Content-Type": "application/x-ndjson"})
            assert appended.status_code == 201, appended.text
            second = appended.json()
            version_ids.append(second["id"])
            assert second["version_number"] == 2
            for version_id in version_ids:
                downloaded = client.get("/dataset-versions/" + version_id + "/content")
                assert downloaded.status_code == 200
                assert downloaded.content == data
        finally:
            for version_id in reversed(version_ids):
                assert client.delete("/dataset-versions/" + version_id).status_code == 204
