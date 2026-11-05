"""CompShare signed transport with read-only queries and explicit instance mutations."""
from __future__ import annotations

import hashlib
import json
import re

import httpx

from modelforge.errors import AppError

READ_ACTIONS = frozenset({
    "DescribeCompShareSupportZone", "DescribeAvailableCompShareInstanceTypes",
    "DescribeCompShareImages", "DescribeModelRepositoryModels",
    "CheckCompShareResourceCapacity", "DescribeCompShareInstance",
    "GetCompShareInstanceMonitor", "GetCompShareInstanceUserPrice",
    "GetProjectList", "DescribeCompShareCustomImages",
})


def encode_parameters(parameters: dict) -> dict[str, str]:
    """Official SDK dotted-list encoding, including lowercase booleans."""
    result = {}
    def visit(key, value):
        if value is None:
            return
        if isinstance(value, dict):
            for child, item in value.items():
                visit(f"{key}.{child}", item)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(f"{key}.{index}", item)
        else:
            result[key] = str(value).lower() if isinstance(value, bool) else str(value)
    for key, value in parameters.items():
        visit(key, value)
    return result


def sign_parameters(parameters: dict[str, str], private_key: str) -> str:
    text = "".join(key + value for key, value in sorted(parameters.items())) + private_key
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def provider_error(status: int, message: str = "", retcode: int | None = None) -> AppError:
    # Vendor text is classification input only; it is never returned or logged.
    text = message.lower()
    if retcode == 226604:
        return AppError(409, "cloud_out_of_stock", "当前规格库存不足，请刷新或选择其他组合。")
    if retcode == 226603:
        return AppError(409, "cloud_incompatible", "优云报告镜像不支持所选卡型，请重新选择。")
    if retcode == 226601:
        return AppError(409, "cloud_account_arrears", "优云账号欠费，暂时不能创建实例。")
    if retcode == 226602:
        return AppError(409, "cloud_account_expired", "优云账号已过期，暂时不能创建实例。")
    if retcode == 226605:
        return AppError(409, "cloud_image_operation_in_progress", "该实例已有镜像任务，请先核对任务状态。")
    if retcode == 226606:
        return AppError(409, "cloud_account_unverified", "优云账号未完成实名认证，不能创建实例。")
    if retcode == 8433:
        return AppError(503, "cloud_service_unavailable", "优云服务暂时异常，请稍后核对。")
    if re.search(r"(credential|token|key).{0,30}expired|expired.{0,30}(credential|token|key)|凭据.{0,15}过期|密钥.{0,15}过期", text):
        return AppError(503, "cloud_credentials_expired", "优云凭据已过期，请更新后端配置后重试。")
    if status == 403 or re.search(r"permission|forbidden|not authorized|权限|无权", text):
        return AppError(503, "cloud_permission_denied", "优云账号无权执行此查询，请核对权限。")
    if status == 401 or re.search(r"signature|credential|public.?key|private.?key|签名|密钥", text):
        return AppError(503, "cloud_credentials_rejected", "优云凭据或签名被拒绝，请核对后端配置。")
    if status == 429:
        return AppError(503, "cloud_rate_limited", "优云查询频率受限，请稍后重试。")
    return AppError(502, "cloud_api_error", "优云查询失败，请稍后重试。")


class UCloud:
    def __init__(self, settings, client: httpx.Client):
        self.settings, self.client = settings, client

    def query(self, action: str, parameters: dict) -> dict:
        if action not in READ_ACTIONS:
            raise ValueError("Only explicitly allowed read-only actions are supported")
        return self._request(action, parameters)

    def _request(self, action: str, parameters: dict) -> dict:
        settings = self.settings
        if not settings.ucloud_public_key or not settings.ucloud_private_key:
            raise AppError(503, "cloud_not_configured", "尚未配置优云凭据，请在后端环境中配置公钥和私钥。")
        parameters = dict(parameters)
        explicit_project = parameters.pop("ProjectId", None)
        payload = encode_parameters({**parameters, "Action": action,
            "ProjectId": explicit_project or settings.ucloud_project_id,
            "PublicKey": settings.ucloud_public_key.get_secret_value()})
        payload["Signature"] = sign_parameters(payload, settings.ucloud_private_key.get_secret_value())
        try:
            with self.client.stream("POST", settings.ucloud_api_url, data=payload,
                    timeout=settings.ucloud_timeout, follow_redirects=False) as response:
                if response.status_code != 200:
                    raise provider_error(response.status_code)
                body = bytearray()
                for chunk in response.iter_bytes():
                    if len(body) + len(chunk) > 8 * 1024 * 1024:
                        raise AppError(502, "cloud_invalid_response", "优云响应过大，请缩小查询范围。")
                    body.extend(chunk)
        except httpx.TimeoutException:
            raise AppError(504, "cloud_timeout", "优云查询超时，请重试。") from None
        except httpx.HTTPError:
            raise AppError(503, "cloud_unavailable", "无法连接优云 API，请检查网络后重试。") from None
        try:
            result = json.loads(body)
            if not isinstance(result, dict) or type(result.get("RetCode")) is not int:
                raise ValueError()
            if result["RetCode"] != 0:
                raise provider_error(200, str(result.get("Message", "")), result["RetCode"])
            if result.get("Action") != action + "Response":
                raise ValueError()
            return result
        except (ValueError, UnicodeDecodeError):
            raise AppError(502, "cloud_invalid_response", "优云响应不符合查询契约，请稍后重试。") from None


class UCloudInstances(UCloud):
    """Explicit server-only mutations; inherited query stays read-only."""

    def _mutation(self, action, parameters):
        try:
            return self._request(action, parameters)
        except AppError as error:
            raise AppError(error.status, error.code, '优云操作结果需要核对；保留实例关联，先查询再决定后续操作。') from None

    def create(self, parameters):
        result = self._mutation('CreateCompShareInstance', parameters)
        identifiers = result.get('UHostIds')
        if (not isinstance(identifiers, list) or len(identifiers) != 1
                or not isinstance(identifiers[0], str)
                or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', identifiers[0])):
            raise AppError(502, 'cloud_invalid_response', 'Creation identity is unverified')
        return {'UHostIds': identifiers}

    def start(self, parameters):
        result = self._mutation('StartCompShareInstance', parameters)
        if result.get('UHostId') != parameters['UHostId']:
            raise AppError(502, 'cloud_invalid_response', 'Start acknowledgement is unverified')
        return {'UHostId': result['UHostId']}

    def stop(self, parameters):
        result = self._mutation('StopCompShareInstance', parameters)
        if result.get('UHostId') != parameters['UHostId']:
            raise AppError(502, 'cloud_invalid_response', 'Stop acknowledgement is unverified')
        return {'UHostId': result['UHostId']}

    def terminate(self, parameters):
        result = self._mutation('TerminateCompShareInstance', parameters)
        recycle = result.get('InRecycle')
        if (result.get('UHostId') != parameters['UHostId']
                or recycle not in (None, 'Yes', 'No')):
            raise AppError(502, 'cloud_invalid_response', 'Termination acknowledgement is unverified')
        return {
            'UHostId': result['UHostId'],
            'InRecycle': recycle if recycle is not None else 'NotReported',
        }

    def update_stop_scheduler(self, parameters):
        result = self._mutation('UpdateCompShareStopScheduler', parameters)
        # The vendor acknowledges the scheduler but has historically omitted
        # UHostId from the response. Never infer a timer from an unrelated row.
        if result.get('UHostId') not in (None, parameters['UHostId']):
            raise AppError(502, 'cloud_invalid_response', 'Scheduler acknowledgement is unverified')
        return {
            'UHostId': parameters['UHostId'],
            'SchedulerStopTime': parameters['SchedulerStopTime'],
        }

    def delete_stop_scheduler(self, parameters):
        result = self._mutation('DeleteCompShareStopScheduler', parameters)
        if result.get('UHostId') not in (None, parameters['UHostId']):
            raise AppError(502, 'cloud_invalid_response', 'Scheduler deletion acknowledgement is unverified')
        return {'UHostId': parameters['UHostId']}

    def reset_password(self, parameters):
        result = self._mutation('ResetCompShareInstancePassword', parameters)
        if result.get('UHostId') not in (None, parameters['UHostId']):
            raise AppError(502, 'cloud_invalid_response', 'Password reset acknowledgement is unverified')
        return {'UHostId': parameters['UHostId']}
