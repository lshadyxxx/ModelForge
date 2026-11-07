"""Official-vector and wire contracts; fixtures are not live account evidence."""
import json
import os
from types import SimpleNamespace
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MF_PG_PASSWORD", "test-only")
os.environ.setdefault("MF_MINIO_ACCESS_KEY", "test-only")
os.environ.setdefault("MF_MINIO_SECRET_KEY", "test-only")

from modelforge.entrypoints.api import app
from modelforge.errors import AppError
from modelforge.infrastructure.ucloud import UCloud, encode_parameters, sign_parameters
from modelforge.modules.resources.catalog import Catalog
from modelforge.settings import Settings


def settings(**kwargs):
    return Settings(ucloud_public_key="public-test-only", ucloud_private_key="private-test-only", **kwargs)


def resources(handler, config=None):
    return SimpleNamespace(settings=config or settings(), source_http=httpx.Client(
        transport=httpx.MockTransport(handler), trust_env=False, follow_redirects=False))


def result(action, **kwargs):
    return httpx.Response(200, json={"Action": action + "Response", "RetCode": 0, **kwargs})


def test_signature_matches_published_upstream_vector():
    assert sign_parameters({"foo": "bar"}, "my_private_key") == "634edc1bb957c0d65e5ab5494cf3b7784fbc87af"
    assert encode_parameters({"Disks": [{"IsBoot": True, "Size": 60}],
        "MachineTypes": ["test-gpu"], "Missing": None}) == {
        "Disks.0.IsBoot": "true", "Disks.0.Size": "60", "MachineTypes.0": "test-gpu"}


def test_signed_transport_never_sends_private_key_or_uses_query_string():
    def handler(request):
        assert request.method == "POST"
        assert str(request.url) == "https://api.compshare.cn"
        assert request.headers["Content-Type"].startswith("application/x-www-form-urlencoded")
        assert b"private-test-only" not in request.content
        payload = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
        signature = payload.pop("Signature")
        assert signature == sign_parameters(payload, "private-test-only")
        assert payload["PublicKey"] == "public-test-only"
        assert payload["MachineTypes.0"] == "new-gpu"
        assert payload["ProjectId"] == "project-test"
        return result("DescribeAvailableCompShareInstanceTypes", AvailableInstanceTypes=[])
    r = resources(handler, settings(ucloud_project_id="project-test"))
    assert Catalog(r).read("specs", {"Region": "new-region", "MachineTypes": ["new-gpu"]})["state"] == "empty"


def test_missing_credentials_and_write_action_never_hit_network():
    def fail(request):
        pytest.fail("Network must not be used")
    r = resources(fail, Settings(ucloud_public_key=None, ucloud_private_key=None))
    with pytest.raises(AppError) as e:
        UCloud(r.settings, r.source_http).query("DescribeCompShareSupportZone", {})
    assert e.value.code == "cloud_not_configured"
    with pytest.raises(ValueError):
        UCloud(settings(), r.source_http).query("CreateCompShareInstance", {})


@pytest.mark.parametrize("response,code", [
    (httpx.Response(401), "cloud_credentials_rejected"),
    (httpx.Response(403), "cloud_permission_denied"),
    (httpx.Response(429), "cloud_rate_limited"),
    (httpx.Response(503), "cloud_api_error"),
    (httpx.Response(302, headers={"Location": "https://other.invalid"}), "cloud_api_error"),
    (httpx.Response(200, json={"RetCode": 1001, "Message": "Signature rejected: private-test-only"}), "cloud_credentials_rejected"),
    (httpx.Response(200, json={"RetCode": 1001, "Message": "Credential expired: private-test-only"}), "cloud_credentials_expired"),
    (httpx.Response(200, json={"RetCode": 1002, "Message": "Permission denied"}), "cloud_permission_denied"),
    (httpx.Response(200, json={"RetCode": 226604, "Message": ""}), "cloud_out_of_stock"),
    (httpx.Response(200, json={"RetCode": 226603}), "cloud_incompatible"),
    (httpx.Response(200, json={"RetCode": 226602, "Message": "The instance has expired"}), "cloud_account_expired"),
    (httpx.Response(200, content=b"not json"), "cloud_invalid_response"),
    (httpx.Response(200, json={"RetCode": "0"}), "cloud_invalid_response"),
    (httpx.Response(200, json={"RetCode": 0, "Action": "WrongResponse"}), "cloud_invalid_response"),
])
def test_provider_failures_are_distinct_and_sanitized(response, code):
    r = resources(lambda request: response)
    with pytest.raises(AppError) as e:
        Catalog(r).read("zones", {})
    assert e.value.code == code
    assert "private-test-only" not in e.value.message
    assert e.value.details is None


@pytest.mark.parametrize("exception,code", [(httpx.ReadTimeout("private-test-only"), "cloud_timeout"),
    (httpx.ConnectError("private-test-only"), "cloud_unavailable")])
def test_transport_exception_does_not_expose_credentials(exception, code):
    def fail(request):
        raise exception
    r = resources(fail)
    with pytest.raises(AppError) as e:
        Catalog(r).read("zones", {})
    assert e.value.code == code and "private-test-only" not in e.value.message


@pytest.mark.parametrize("payload", [{}, {"ZoneInfo": None}, {"ZoneInfo": [{"Region": 3}]}, {"ZoneInfo": ["bad"]}])
def test_malformed_directory_does_not_become_empty(payload):
    r = resources(lambda q: result("DescribeCompShareSupportZone", **payload))
    with pytest.raises(AppError) as e:
        Catalog(r).read("zones", {})
    assert e.value.code == "cloud_invalid_response"


def test_instance_projection_strips_passwords_and_unrecognized_fields():
    row = {"UHostId": "uhost-test", "Name": "name", "State": "Running", "Zone": "z",
        "Region": "r", "CPU": 4, "Memory": 8192, "GPU": 1,
        "Password": "secret", "FileBrowserPassword": "secret", "SshLoginCommand": "secret"}
    r = resources(lambda q: result("DescribeCompShareInstance", UHostSet=[row], TotalCount=1))
    value = Catalog(r).read("instances", {"Limit": 20, "Offset": 0})
    assert "secret" not in json.dumps(value)
    assert value["items"][0]["Memory"] == 8192
    assert value["compatibility"] == "unverified"


def test_capacity_false_is_not_error_or_empty():
    r = resources(lambda q: result("CheckCompShareResourceCapacity", Specs=[
        {"Gpu": 1, "Cpu": 8, "Mem": 16, "ResourceEnough": False}]))
    value = Catalog(r).read("capacity", {})
    assert value["state"] == "out_of_stock" and value["total"] == 1
    assert value["fetched_at"] and value["compatibility"] == "unverified"


def test_http_filters_and_pagination_preserve_case_sensitive_provider_names(monkeypatch):
    seen = []
    def handler(q):
        d = {key: value[0] for key, value in parse_qs(q.content.decode()).items()};seen.append(d)
        if d["Action"] == "DescribeCompShareImages":
            return result(d["Action"], ImageSet=[], TotalCount=7)
        return result(d["Action"], Models=[])
    monkeypatch.setattr(app.state, "resources", resources(handler), raising=False)
    c = TestClient(app)
    images = c.get("/api/v1/resources/ucloud/images?region=chosen&offset=5&limit=2&name=Torch")
    assert images.status_code == 200
    assert images.json()["total"] == 7 and images.json()["state"] == "ready"
    assert images.json()["filters"] == {"Region": "chosen", "Name": "Torch", "ImageType": "System", "Offset": 5, "Limit": 2}
    assert c.get("/api/v1/resources/ucloud/models?region=chosen&name=abc&tags=LLM").status_code == 200
    assert seen[-1]["name"] == "abc" and seen[-1]["tags"] == "LLM"
    assert "Name" not in seen[-1]
    assert c.get("/api/v1/resources/ucloud/images?region=chosen&limit=101").status_code == 422
    assert c.post("/api/v1/resources/ucloud/instances").status_code == 405


def test_configuration_exposes_no_credentials_and_missing_is_not_empty(monkeypatch):
    r = resources(lambda q: pytest.fail("No query expected"), Settings(ucloud_public_key=None, ucloud_private_key=None))
    monkeypatch.setattr(app.state, "resources", r, raising=False)
    c = TestClient(app)
    assert c.get("/api/v1/resources/ucloud/configuration").json() == {
        "configured": False,
        "default_region": None,
        "mode": "read_only",
        "write_enabled": False,
        "reason": "未配置优云凭据；计算环境写入保持关闭。",
    }
    response = c.get("/api/v1/resources/ucloud/zones")
    assert response.status_code == 503 and response.json()["error"]["code"] == "cloud_not_configured"
    assert "public_key" not in response.text


def test_configuration_with_credentials_is_always_write_enabled(monkeypatch):
    r = resources(
        lambda q: pytest.fail("No query expected"),
        Settings(
            ucloud_public_key="public-test-only",
            ucloud_private_key="private-test-only",
            ucloud_region="cn-bj2",
        ),
    )
    monkeypatch.setattr(app.state, "resources", r, raising=False)
    assert TestClient(app).get(
        "/api/v1/resources/ucloud/configuration"
    ).json() == {
        "configured": True,
        "default_region": "cn-bj2",
        "mode": "read_write",
        "write_enabled": True,
        "reason": None,
    }


def test_credentials_cannot_be_redirected_to_another_endpoint():
    with pytest.raises(ValueError):
        settings(ucloud_api_url="http://api.compshare.cn")
    with pytest.raises(ValueError):
        settings(ucloud_api_url="https://other.invalid")


@pytest.mark.parametrize("kind,key,row", [
    ("zones", "ZoneInfo", {"Region": "r", "Zone": "z", "Describe": "测试", "IsPod": True}),
    ("specs", "AvailableInstanceTypes", {"Name": "GPU-new", "Zone": "z", "Status": "Normal",
        "MachineSizes": [{"Gpu": 1, "Collection": [{"Cpu": 8, "Memory": [16, 32]}]}],
        "GraphicsMemory": {"Value": 24}, "CpuPlatforms": {"Intel": ["Intel/IceLake"]},
        "Disks": [{"Name": "cloudDisk", "BootDisk": [{"Name": "CLOUD_SSD", "MaximalSize": 1000}]}]}),
    ("images", "ImageSet", {"CompShareImageId": "image-test", "Name": "镜像", "ImageType": "System", "Status": "Available"}),
    ("models", "Models", {"Name": "模型", "Path": "/models/new", "Size": "16GB"}),
    ("monitor", "List", {"UHostId": "uhost-test", "Metrics": [{"MetricKey": "cloudwatch_gpu_util",
        "Tags": {"must_not_export": "private-value"}, "Results": [{"Values": [{"Timestamp": 10, "Value": 3.5}]}]}]}),
])
def test_success_contracts_preserve_documented_values(kind, key, row):
    from modelforge.modules.resources.catalog import CONTRACTS
    action = CONTRACTS[kind][0]
    data = {key: [row]}
    if kind == "monitor":
        data = {"Data": data}
    if kind == "images":
        data["TotalCount"] = 1
    r = resources(lambda q: result(action, **data))
    value = Catalog(r).read(kind, {"Region": "r"})
    assert value["state"] == "ready" and value["total"] == 1
    assert value["items"][0][next(iter(row))] == row[next(iter(row))]
    assert "private-value" not in json.dumps(value)
    if kind == "specs":
        assert value["items"][0]["MachineSizes"][0]["Collection"][0]["Memory"] == [16, 32]
        assert value["items"][0]["Disks"][0]["BootDisk"][0]["MaximalSize"] == 1000


def test_capacity_http_uses_complete_selected_configuration(monkeypatch):
    def handler(q):
        payload = {key: values[0] for key, values in parse_qs(q.content.decode()).items()}
        assert payload["Action"] == "CheckCompShareResourceCapacity"
        assert payload["MachineType"] == "G"
        assert payload["GpuType"] == "new-gpu"
        assert payload["MinimalCpuPlatform"] == "Auto"
        assert payload["Disks.0.IsBoot"] == "true" and payload["Disks.0.Size"] == "60"
        return result(payload["Action"], Specs=[])
    monkeypatch.setattr(app.state, "resources", resources(handler), raising=False)
    body = {"region": "r", "zone": "z", "gpu_type": "new-gpu", "cpu_platform": "Auto",
        "image_id": "image-test", "charge_type": "Dynamic", "disks": [{"IsBoot": True, "Type": "CLOUD_SSD", "Size": 60}]}
    c = TestClient(app)
    assert c.post("/api/v1/resources/ucloud/capacity", json=body).json()["state"] == "empty"
    assert c.post("/api/v1/resources/ucloud/capacity", json={**body, "PrivateKey": "secret"}).status_code == 422
    assert c.post("/api/v1/resources/ucloud/capacity", json={**body, "disks": []}).status_code == 422
    assert c.post("/api/v1/resources/ucloud/capacity", json={**body, "cpu_platform": "Intel/IceLake"}).status_code == 422


def test_price_uses_official_postpay_fields_and_discounted_breakdown():
    seen = {}

    def handler(request):
        payload = {
            key: values[0]
            for key, values in parse_qs(request.content.decode()).items()
        }
        seen.update(payload)
        return result(
            "GetCompShareInstanceUserPrice",
            PriceDetails=[
                {
                    "ChargeType": "Postpay",
                    "Instance": 1.48,
                    "SystemDisks": 0.18,
                    "Disks": 0,
                    "CompShareImage": 0,
                    "InstanceDiscountType": 1,
                }
            ],
            OriginalPriceDetails=[
                {
                    "ChargeType": "Postpay",
                    "Instance": 1.66,
                    "SystemDisks": 0.18,
                }
            ],
        )

    value = Catalog(resources(handler)).price(
        region="cn-test",
        zone="cn-test-01",
        gpu_type="4090",
        cpu=16,
        memory_mb=65536,
        charge_type="Postpay",
        image_id="image-test",
        disks=[{"IsBoot": True, "Type": "CLOUD_SSD", "Size": 60}],
    )
    assert seen["Action"] == "GetCompShareInstanceUserPrice"
    assert seen["Region"] == "cn-test"
    assert seen["Zone"] == "cn-test-01"
    assert seen["Gpu"] == "1"
    assert seen["Cpu"] == "16"
    assert seen["Memory"] == "65536"
    assert seen["ChargeType"] == "Postpay"
    assert seen["Disks.0.IsBoot"] == "true"
    assert seen["Disks.0.Type"] == "CLOUD_SSD"
    assert seen["Disks.0.Size"] == "60"
    assert value["state"] == "available"
    assert value["currency"] == "CNY"
    assert value["unit"] == "hour"
    assert value["hourly"] == 1.66
    assert value["breakdown"] == {
        "instance": 1.48,
        "system_disks": 0.18,
        "data_disks": 0.0,
        "image": 0.0,
    }
    assert value["original_amount"] == 1.84


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"PriceDetails": []},
        {"PriceDetails": [{"ChargeType": "Month", "Instance": 100}]},
        {"PriceDetails": [{"ChargeType": "Postpay", "Instance": -1}]},
        {"PriceDetails": [{"ChargeType": "Postpay", "Instance": True}]},
    ],
)
def test_price_never_invents_amounts(payload):
    r = resources(
        lambda request: result("GetCompShareInstanceUserPrice", **payload)
    )
    with pytest.raises(AppError) as error:
        Catalog(r).price(
            region="cn-test",
            zone="cn-test-01",
            gpu_type="4090",
            cpu=16,
            memory_mb=65536,
        )
    assert error.value.code == "cloud_price_unavailable"


def test_capacity_and_price_http_keep_quote_separate_from_inventory(monkeypatch):
    def handler(request):
        payload = {
            key: values[0]
            for key, values in parse_qs(request.content.decode()).items()
        }
        if payload["Action"] == "CheckCompShareResourceCapacity":
            return result(
                payload["Action"],
                Specs=[
                    {
                        "Gpu": 1,
                        "Cpu": 8,
                        "Mem": 32,
                        "ResourceEnough": True,
                    }
                ],
            )
        if payload["Action"] == "GetCompShareInstanceUserPrice":
            return result(
                payload["Action"],
                PriceDetails=[
                    {
                        "ChargeType": "Postpay",
                        "Instance": 0.99,
                        "SystemDisks": 0.12,
                    }
                ],
            )
        raise AssertionError(payload["Action"])

    monkeypatch.setattr(
        app.state, "resources", resources(handler), raising=False
    )
    client = TestClient(app)
    body = {
        "region": "r",
        "zone": "z",
        "gpu_type": "gpu",
        "cpu": 8,
        "memory_mb": 32768,
        "cpu_platform": "Auto",
        "image_id": "image-test",
        "charge_type": "Postpay",
        "disks": [{"IsBoot": True, "Type": "CLOUD_SSD", "Size": 60}],
    }
    capacity = client.post("/api/v1/resources/ucloud/capacity", json=body)
    assert capacity.status_code == 200
    assert capacity.json()["state"] == "ready"
    assert capacity.json()["quote"]["hourly"] == 1.11
    price_body = {
        key: value for key, value in body.items() if key != "cpu_platform"
    }
    price = client.post("/api/v1/resources/ucloud/price", json=price_body)
    assert price.status_code == 200
    assert price.json()["hourly"] == 1.11
    assert client.post(
        "/api/v1/resources/ucloud/price",
        json={**price_body, "PrivateKey": "secret"},
    ).status_code == 422


def test_oversized_response_is_rejected_and_not_forwarded():
    r = resources(lambda q: httpx.Response(200, content=b"x" * (8 * 1024 * 1024 + 1)))
    with pytest.raises(AppError) as e:
        Catalog(r).read("zones", {})
    assert e.value.code == "cloud_invalid_response"


def test_blank_cloud_credentials_are_missing():
    s = Settings(ucloud_public_key="  ", ucloud_private_key="")
    assert s.ucloud_public_key is None and s.ucloud_private_key is None


def test_image_http_accepts_provider_null_tags_as_no_tags(monkeypatch):
    row = {"CompShareImageId": "image-test", "Name": "镜像", "ImageType": "System",
        "Status": "Available", "Tags": None}
    monkeypatch.setattr(app.state, "resources", resources(lambda q: result(
        "DescribeCompShareImages", ImageSet=[row], TotalCount=1)), raising=False)
    response = TestClient(app).get("/api/v1/resources/ucloud/images?region=chosen")
    assert response.status_code == 200
    assert response.json()["items"][0]["Tags"] == []
    assert response.json()["compatibility"] == "unverified"


@pytest.mark.parametrize("tags", ["torch", 0, False, [1], {"tag": "torch"}])
def test_image_http_rejects_malformed_tags(monkeypatch, tags):
    row = {"CompShareImageId": "image-test", "Name": "镜像", "ImageType": "System",
        "Status": "Available", "Tags": tags}
    monkeypatch.setattr(app.state, "resources", resources(lambda q: result(
        "DescribeCompShareImages", ImageSet=[row], TotalCount=1)), raising=False)
    response = TestClient(app).get("/api/v1/resources/ucloud/images?region=chosen")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "cloud_invalid_response"


def test_image_http_default_uses_one_provider_type_for_global_pagination(monkeypatch):
    def handler(request):
        payload = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
        # Without a type, the real provider paginates each type independently.
        if payload.get("ImageType") == "System":
            types = ["System"]
        else:
            types = ["System", "App", "Other"]
        rows = [{"CompShareImageId": "image-" + kind, "Name": kind,
            "ImageType": kind, "Status": "Available"} for kind in types]
        return result("DescribeCompShareImages", ImageSet=rows, TotalCount=len(rows))
    monkeypatch.setattr(app.state, "resources", resources(handler), raising=False)
    response = TestClient(app).get("/api/v1/resources/ucloud/images?region=chosen&limit=1")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["filters"]["ImageType"] == "System"


def test_custom_image_http_uses_dedicated_action_and_filters_locally(monkeypatch):
    seen = []
    rows = [
        {
            "CompShareImageId": "custom-training",
            "Name": "modelforge-training-base",
            "ImageType": "Custom",
            "Status": "Available",
            "Author": "",
            "Tags": [],
            "Description": "Prebuilt runtime",
            "Zone": "cn-bj2-03",
            "ImageSupportZone": [
                {"Region": "cn-bj2", "Zone": "cn-bj2-03", "Status": ""}
            ],
        },
        {
            "CompShareImageId": "custom-other-zone",
            "Name": "modelforge-training-base-copy",
            "ImageType": "Custom",
            "Status": "Available",
            "Author": "",
            "Tags": [],
            "Zone": "cn-sh2-02",
            "ImageSupportZone": [
                {"Region": "cn-sh2", "Zone": "cn-sh2-02", "Status": ""}
            ],
        },
    ]

    def handler(request):
        payload = {
            key: values[0]
            for key, values in parse_qs(request.content.decode()).items()
        }
        seen.append(payload)
        offset = int(payload.get("Offset", 0))
        limit = int(payload.get("Limit", 100))
        return result(
            "DescribeCompShareCustomImages",
            ImageSet=rows[offset:offset + limit],
            TotalCount=len(rows),
        )

    monkeypatch.setattr(
        app.state,
        "resources",
        resources(handler),
        raising=False,
    )
    response = TestClient(app).get(
        "/api/v1/resources/ucloud/images"
        "?region=cn-bj2&zone=cn-bj2-03&name=training"
        "&image_type=Custom&offset=0&limit=10"
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert [item["CompShareImageId"] for item in response.json()["items"]] == [
        "custom-training"
    ]
    assert response.json()["filters"] == {
        "Region": "cn-bj2",
        "Zone": "cn-bj2-03",
        "Name": "training",
        "ImageType": "Custom",
        "Offset": 0,
        "Limit": 10,
    }
    assert seen[0]["Action"] == "DescribeCompShareCustomImages"
    assert seen[0]["Region"] == "cn-bj2"
    assert "Zone" not in seen[0]
    assert "Name" not in seen[0]
