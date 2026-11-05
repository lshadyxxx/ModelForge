"""Provider-facing checks for managed training image profiles."""

from types import SimpleNamespace

import pytest

from modelforge.errors import AppError
from modelforge.modules.training.provisioning import TrainingProvisioning


class ImageProvider:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def query(self, action, parameters):
        self.calls.append((action, parameters))
        return self.response


def build_provisioning(response):
    provider = ImageProvider(response)
    resources = SimpleNamespace(
        pool=object(),
        settings=SimpleNamespace(),
        source_http=object(),
    )
    lifecycle = SimpleNamespace(provider=provider)
    provisioning = TrainingProvisioning(
        resources,
        lifecycle,
        first_boot=SimpleNamespace(),
    )
    return provisioning, provider


def test_custom_training_image_uses_custom_image_listing():
    image_id = "compshareImage-1xc89j1np56m"
    provisioning, provider = build_provisioning(
        {"ImageSet": [{"CompShareImageId": image_id, "Status": "Available"}]}
    )

    provisioning._check_image(
        "cn-bj2",
        "cn-bj2-03",
        {"image_id": image_id, "image_type": "Custom"},
    )

    assert provider.calls == [
        (
            "DescribeCompShareCustomImages",
            {
                "Region": "cn-bj2",
                "CompShareImageId": image_id,
                "Offset": 0,
                "Limit": 20,
            },
        )
    ]


def test_system_training_image_uses_system_image_catalog():
    image_id = "compshareImage-1fc8fjody17l"
    provisioning, provider = build_provisioning(
        {"ImageSet": [{"CompShareImageId": image_id, "Status": "Available"}]}
    )

    provisioning._check_image(
        "cn-bj2",
        "cn-bj2-03",
        {"image_id": image_id, "image_type": "System"},
    )

    assert provider.calls == [
        (
            "DescribeCompShareImages",
            {
                "Region": "cn-bj2",
                "Zone": "cn-bj2-03",
                "CompShareImageId": image_id,
            },
        )
    ]


def test_custom_training_image_must_be_available():
    image_id = "compshareImage-1xc89j1np56m"
    provisioning, _ = build_provisioning(
        {"ImageSet": [{"CompShareImageId": image_id, "Status": "Creating"}]}
    )

    with pytest.raises(AppError) as caught:
        provisioning._check_image(
            "cn-bj2",
            "cn-bj2-03",
            {"image_id": image_id, "image_type": "Custom"},
        )

    assert caught.value.code == "training_image_unavailable"
