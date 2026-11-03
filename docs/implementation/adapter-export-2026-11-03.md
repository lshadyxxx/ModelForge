# Adapter 包导出记录

日期：2026-11-03。

## 背景

产品规格和 M06 已要求“下载托管产物”，但此前实现只提供 Best/Final 元数据、文件清单和平台内推理试用。Adapter 文件已持久化并校验在 MinIO，用户却没有受支持的导出入口，无法把训练产物带到兼容的独立部署环境。

## 已实现

- 新增 `GET /api/v1/serving/adapters/{id}/download`。
- 只允许下载状态为 `available` 的 Adapter。
- 下载前重新核对 PostgreSQL 中的不可变清单、MinIO 中的 `manifest.json`、每个对象的实际大小与 SHA-256。
- ZIP 固定包含：
  - `manifest.json`
  - `adapter_config.json`
  - `adapter_model.safetensors`
- 响应提供 `Content-Disposition`、`X-Content-SHA256` 和 `X-Adapter-Fingerprint`。
- 模型页面显示“下载 BEST/FINAL Adapter 包”，并明确 Adapter 不是独立模型，部署时必须加载指纹相同的基础模型。

任何清单、对象缺失、长度或摘要不一致都会在向浏览器发送 ZIP 前返回稳定错误，不生成部分部署包。

## 验证证据

- 后端完整回归：`318 passed, 183 skipped`。
- 前端测试：`30 passed`。
- 前端生产构建：通过，46 个模块完成构建。
- 真实 Best Adapter：`a515ea2c-74f9-5982-b5aa-5c4985eb3604`。
- 下载 ZIP：`20,243,357` 字节。
- ZIP SHA-256：`1f48d99063955f76004bf4b8bdeb3a8769543bb6c87fc74725e7a587a12319e3`。
- 响应头摘要、独立文件摘要一致。
- 同一 Adapter 连续下载两次得到完全相同的字节、长度和 SHA-256；ZIP 条目使用固定元数据以支持稳定审计。
- `adapter_config.json`：`1,090` 字节，SHA-256 `1353e85612d067b143ddcb1280b08951a58e4da9ea7835598aad7c8be00449e6`。
- `adapter_model.safetensors`：`20,236,472` 字节，SHA-256 `be46405d76279b78c5010c1e56a947718fceb858d38877f1516f898a47681135`。
- ZIP 完整性与两个成员摘要均与 `manifest.json` 一致。
- 该 Adapter 绑定的基础模型指纹：`ffeb1654eaf9f55ac1ece9d1396c006cb17ff6d18f2d21a120fd0cef28a0166a`（Qwen3-0.6B）。

真实审计文件保留在本地 `.runtime/adapter-download-audit/`，不进入 Git。

## 部署边界

Adapter 是 LoRA 增量权重，不能单独启动。独立环境必须先取得与清单指纹一致的完整基础模型，再由兼容的 PEFT 或 vLLM LoRA 运行时加载该 Adapter。

本次交付覆盖训练产物的受支持导出，不包含合并后的完整模型、自动生成生产部署清单或经独立环境验证的 vLLM CLI 启动命令。平台内 vLLM 试用与导出包属于两项不同能力；前者已验收，不代替后者在目标生产环境中的验收。
