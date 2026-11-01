# 优云只读目录增量（2026-10-31）

ticket 04 已完成本轮真实账号只读 API 验收，票据保持开放。凭据仅保存在 Git 忽略的后端 `.env`；未创建实例或进行 GPU 运行。最新结果见下方“真实只读验收”；首批无凭据测试保留为历史记录。

## 实现

- `infrastructure/ucloud.py` 固定七个只读 Action；现有 httpx 发送表单 POST，按官方 SDK 点号数组/嵌套参数编码，字典键排序、追加私钥、SHA-1 签名。不在查询字符串发送凭据；HTTPS 官方网关、禁重定向、超时与 8 MiB 响应限制；不自动重试。
- `modules/resources/catalog.py` 投影可用区、GPU/CPU/内存/磁盘组合、平台镜像、公共模型、容量、实例和监控；忽略未知响应字段、移除实例密码/登录命令与监控标签；畸形响应返回错误，不能当空目录。
- `modules/resources/routes.py` 提供配置状态与查询；配置/签名仅后端，浏览器没有公私钥字段。不提供实例写接口；GPU 互斥/实例所有权仍属后续票据。
- 前端计算环境沿用既有样式，先查询区域再筛选目录，镜像分页，显示每次 fetched_at 与已应用 filters；失败保留上次结果但注明可能过期。库存从当前区域的单卡规格、镜像和系统盘目录选择，兼容性保持未验证。
- 完整筛选快照比较控制结果可用性：更换地域/可用区、GPU、镜像名称或类型后，旧镜像页不能继续分页，旧规格/镜像不能提交库存；规格选项还须匹配选定可用区。镜像刷新回到第一页，分页只忽略 Offset。查询中、失败、条件变化和空目录分别显示。
- 采用标准库和现有 httpx，没有新增 SDK 依赖。官方 docs 的安装命令确认为 ucloud-sdk-python3；上游仓库与 PyPI 公共元数据已核对，当前 0.11.152，但不因候选存在就引入。

## 官方契约依据

- [支持可用区](https://www.compshare.cn/docs/gpus/instance/describecompsharesupportzone)
- [规格组合](https://www.compshare.cn/docs/gpus/instance/describeavailablecompshareinstancetypes)
- [平台镜像](https://www.compshare.cn/docs/gpus/image/describecompshareimages)
- [公共模型](https://www.compshare.cn/docs/gpus/instance/describemodelrepositorymodels)
- [容量查询](https://www.compshare.cn/docs/gpus/instance/checkcompshareresourcecapacity)
- [实例详情](https://www.compshare.cn/docs/gpus/instance/describecompshareinstance)
- [监控](https://www.compshare.cn/docs/gpus/instance/getcompshareinstancemonitor)
- [错误码](https://www.compshare.cn/docs/gpus/compshareerrorcode)
- [官方签名](https://github.com/ucloud/ucloud-sdk-python3/blob/master/ucloud/core/auth/_cfg.py)、[参数编码](https://github.com/ucloud/ucloud-sdk-python3/blob/master/ucloud/core/typesystem/encoder.py)、[表单发送](https://github.com/ucloud/ucloud-sdk-python3/blob/master/ucloud/core/client/_client.py)。官方签名固定向量用于测试。

2026-10-31 本地获取官方文档与 GitHub API 上游源码快照；仅作契约依据，未执行上游下载代码。原始公共资料保存在临时证据目录，不包含账号密钥。

## 首批实现验证与限制（配置凭据前）

首批实现专项命令：`backend/.venv/Scripts/python.exe -m pytest -q backend/tests/test_ucloud_catalog.py`；前端 `npm --prefix frontend test`、`npm --prefix frontend run build`。36 项云目录契约测试通过：官方签名向量、数组/布尔编码、请求参数、七类成功投影、失败分类、超时/不可达、空目录与无库存区分、无凭据及动作门禁、实例敏感字段投影、响应过大、HTTP 筛选分页。首批前端 12 项测试与 TypeScript/Vite 构建通过；新增 4 项覆盖地域变化、镜像分页筛选、GPU 选项和嵌套库存输入的快照匹配。它们验证共享比较规则，不等于已操作页面控件。

后端宿主与新镜像常规套件各 194 passed、19 skipped；新镜像在隔离 PostgreSQL/MinIO 中为 212 passed、1 skipped，临时库和空桶已清除。独立实际 FastAPI app + MockTransport 验收 64 场景、54 次模拟供应商请求通过；这些是模拟契约证据。

首次 Spec 与 Adversarial 审查分别发现跨筛选条件镜像分页、旧规格/镜像仍可用于库存查询两项 P2；当前源码修复后，定向复审均无遗留确认缺陷。独立 QA 也核对了筛选规则、构建和静态 HTTP；同条件刷新时误报条件更改的文案已在最终收尾中修正。浏览器视觉及交互仍未验收。

最终运行镜像 `modelforge-backend:cloud-catalog-20261031` 的 API/Worker 各 30 个 Python 文件哈希与工作区一致。最终 Web 构建为 `index-BEYZfqSH.js`。同源入口 `http://127.0.0.1:8092`；状态 ready，缺配置查询返回 503 `cloud_not_configured`。

首批阶段仅核验了配置缺失路径，当时真实账号鉴权、目录/库存及页面交互待验收；随后真实 API 结果见下方记录。社区/自制镜像和价格查询尚未纳入此首批实现。训练兼容性、外部模型内容指纹、租约、实例关联和回收、远程训练、产物回传与独立推理均未完成。

## 真实只读验收（2026-10-31）

- 用户提供凭据后，配置已由后端 `.env` 注入 API/Worker，`configured=true`、`mode=read_only`；Web 同源 `/api/v1/status` 为 ready，PostgreSQL、MinIO、API、Worker 均 up。没有实例写接口或云资源创建。
- 返回 5 个可用区，涉及 cn-wlcb、cn-sh2、cn-bj2 三个地域。三个地域的未限定可用区规格查询各返回 22 项，公共模型查询各返回 50 项；这是供应商响应快照，不能当作完整商店清单。规格结果可能跨可用区，不能仅凭请求 Region 推断结果归属。指定 cn-wlcb-01 后返回 11 项，按实际目录 GPU 名称筛选返回 1 项；不匹配筛选返回空结果。
- 修复真实镜像 `Tags=null` 引起的 502：仅空值规范化为 `[]`，字符串/数字/非字符串列表等畸形值仍拒绝。供应商省略 ImageType 时按每类独立分页（Limit=2 实返 6 项），API 与页面因此默认明确的 System，可切换 App。System 当前 9 项；App 以 20/20/20/1 四页返回 61 个唯一 ID；类型、名称、空结果、两页无重叠均已核对。超出末页时供应商返回 total=0，保留该原始语义；刷新会回第一页。Other 类可见但未接入页面，社区/自制镜像和价格查询继续后置。
- 公共模型名称大小写变化后的匹配、LLM 标签阳性筛选以及无匹配名称/标签均通过 HTTP。目录路径只证明可见，不证明文件指纹或训练兼容性。
- 库存请求来自实际目录：cn-wlcb-01、4090、Auto、Ubuntu-nvidia 22.04、60 GB CLOUD_SSD 系统盘、Dynamic。返回 8 个组合，2 个单卡组合当时 ResourceEnough=true。它只是验收样本，不是产品默认选择、资源预留、价格或兼容性证明；响应仍 compatibility=unverified。三地域实例列表均空，因此真实 monitor-success 未覆盖。
- 回归：云目录 43 passed；宿主和最终容器后端全套各 201 passed/19 skipped；最终镜像在一次性真实 PostgreSQL/MinIO 全套为 219 passed/1 skipped，确认空桶并清除本次测试库/桶。前端 13/13 与 TypeScript/Vite 构建通过。空值兼容、畸形标签保护、类型默认和前端默认查询快照四种定向破坏均触发预期断言失败，恢复后通过。前端只变更 UI 缺省常量时新测试变红。现有 TestClient/httpx 弃用警告保留，未更改依赖。
- 最终后端镜像 modelforge-backend:ucloud-live-fixed-20261031；API/Worker 各 30 个 Python 源文件哈希与工作区相同。镜像沿用此前依赖并覆盖本轮源码/测试。Web 为 index-CRSlNR6W.js，服务资产与本地产物哈希一致，入口 http://127.0.0.1:8092。两项密钥仅在 Git 忽略的 `.env` 中允许存在；最终扫描其余 327 个仓库/构建文件、同源静态资源、容器日志及本轮证据均为零命中。只记录检查结果，不保存密钥值。
- 独立 QA：20 项真实同源 HTTP 请求和 16 项独立契约/静态检查通过；结论 Passes with gaps。随后对前端默认类型与过滤快照补充契约测试并重建 Web；该测试和 13 项前端全套、TS/Vite 构建通过。浏览器视觉/交互仍受 AGENTS.md 的隔离驱动要求阻塞，本轮没有操作浏览器或桌面。没有实例可验收监控成功，也没有触发真实凭据过期/权限拒绝、供应商中断；这些错误分支仍只有模拟契约证据。ticket 04 保持开放。

原始只读响应、日志、源码一致性、回归和独立 QA 报告位于 OS 临时目录 `<home>/AppData/Local/Temp/modelforge-ucloud-live-20261031-eqsc52_4`，独立报告为其 `qa-independent/report.md`。目录与库存会变化；临时证据不是正式资产。未提交 Git，未推送远程。后续仍是外部基座身份/完整文件指纹、GPU 租约/实例关联、远程执行与双向传输，再进行真实 SFT/LoRA、Best/Final 与独立推理。
