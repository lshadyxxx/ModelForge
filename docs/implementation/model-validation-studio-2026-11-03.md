# 模型验证工作室生产集成记录

日期：2026-11-03。

## 范围

本轮把已确认的 C 版“模型验证工作室”从静态原型集成到正式 React 页面 `frontend/src/features/models/Models.tsx`，并保留现有侧栏、顶部栏、配色和整体信息架构。页面继续调用正式 `/api/v1/models`、`/api/v1/models/limits`、`/api/v1/model-versions/{id}` 和 `/api/v1/serving/adapters` 接口。

实现边界：

- 保留 ModelScope 固定 commit 导入、完整目录上传与恢复、优云外部基座登记、取消、重试、删除保护和存储清理。
- 三种添加来源移入原生 `dialog`，不再占用首屏。
- 模型族按不可变 `model_id` 聚合，状态汇总覆盖该族所有版本，异常优先展示。
- Best/Final 只取当前基座最新一次成功 Attempt 的配对，避免旧训练产物混入。
- Adapter 下载调用正式导出接口；配对按钮只核对当前 API 响应中的版本、指纹和训练兼容记录。
- 文件可用、实例内容一致和运行兼容继续作为三个独立状态，不把目录存在或文件校验解释为可训练。

## 页面与交互

- 桌面端为“模型族与版本索引 / 当前证据工作台 / 验证与操作”三栏。
- 手机端顺序为当前模型与主操作、验证工作台、总览统计、模型族、验证栏。
- 工作台包含验证总览、完整文件清单、训练产物与血缘三个 `tabpanel`。
- Tab 使用 `aria-selected`、`aria-controls`、roving `tabIndex`，支持左右方向键、Home 和 End，并在重绘后保留焦点。
- 模型族和版本选择使用 `aria-pressed`；标题层级保持 H1 → H2 → H3。
- 390px 视口下版本选择改为纵向，Best/Final 改为单列，所有可见功能文字不小于 11px，主要触摸目标不小于 44px。

## Adapter 产物契约

页面和下载包使用同一不可变血缘：

- Adapter 依赖精确匹配的基座模型版本和基座指纹。
- 卡片展示 Adapter ID、Adapter 指纹、来源 Attempt、数据集版本 ID 与 SHA-256、基座模型、基座指纹和创建时间。
- 下载包固定包含 `manifest.json`、`adapter_config.json`、`adapter_model.safetensors`。
- 配对校验在浏览器内基于当前响应字段完成，不代表平台额外执行一次推理验证。
- “用于推理试用”跳转正式推理页；LoRA Adapter 不能独立启动。

## 验证证据

构建与自动化：

- `frontend/npm test`：30 passed。
- `frontend/npm run build`：TypeScript strict 检查通过，Vite 生产构建通过，46 modules transformed。
- 模型/导入/Adapter/推理相关后端回归：147 passed，37 skipped，1 个既有 Starlette/httpx 弃用 warning。
- `git diff --check`：通过。

真实容器与 API：

- 正式 Web：`http://127.0.0.1:8092/#models`。
- PostgreSQL、MinIO、API、Worker 和 Web 均启动；`/api/v1/status` 返回 `ready=true`。
- `/api/v1/models` 返回 2 个真实模型版本。
- `/api/v1/serving/adapters` 返回 4 个真实 Adapter。
- Best `a515ea2c-74f9-5982-b5aa-5c4985eb3604` 实测下载 HTTP 200；ZIP 为 20,243,357 字节，包内严格只有上述三个文件，manifest 中的基座 ID、基座指纹、数据集 ID 和训练兼容指纹与页面响应一致。

Ego 浏览器：

- 桌面 1440×900：无页面横向溢出；模型族、异常筛选、版本切换、Tab 键盘焦点、添加模型三种来源和 Adapter 配对均通过。
- 390×844：无页面横向溢出；当前模型与主操作位于统计之前；版本选择为单列，Adapter Best/Final 为单列。
- 390px 可见触摸目标最小高度为 44px，最小功能文字为 11px。
- 浏览器运行错误和 `console.error` 均为 0。
- 1440×900 与 390×844 的最终页面截图均成功取得；验收同时使用实际 DOM、可访问属性、真实 API 响应、ZIP 回读和多视口计算样式。截图仅保存在本地 `<internal-evidence>`，不进入 Git。

## 保留边界

- 当前兼容基座的 `compatibility_state` 仍为 `unverified`；不能因文件可读、Adapter 可下载或页面可打开而宣称训练兼容已验证。
- 平台整体继续保持 `partial`。更广的模型、GPU、镜像兼容矩阵和容量边界仍由票据 06 跟踪。
- 本轮仅完成本地镜像重建和本地验收，没有推送远端 Git、创建 PR 或执行新的云端资源操作。
