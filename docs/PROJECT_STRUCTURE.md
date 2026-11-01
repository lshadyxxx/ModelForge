# 项目结构设计

状态：目标目录与模块设计；基础骨架已按需落地，尚未创建的业务模块仍属于规划。本文是代码布局、职责归属和依赖方向的统一入口；运行拓扑及数据归属见 [ARCHITECTURE.md](ARCHITECTURE.md)，技术选型见 [TECH_STACK.md](TECH_STACK.md)。

## 设计选择

采用一个仓库、两个工程：`frontend/` 和 `backend/`。后端是按业务组织的模块化单体，API 与 Worker 使用同一个 Python 包、不同进程入口。保持 React + TypeScript + Vite、FastAPI、PostgreSQL、MinIO 和 Docker Compose 的既定选型。产品首版的个人本机访问、无登录及本机回环绑定见[产品规格](../<internal-evidence>)。

产品首版已追加优云远程执行和公共只读基座范围，见 [ADR-0001](adr/0001-ucompshare-remote-execution.md) 与 [ADR-0002](adr/0002-external-readonly-base-models.md)。下方目录仍是按需创建的设计；优云只读签名传输现归 `infrastructure/ucloud.py`，类型化目录投影与 HTTP 接口归 `modules/resources/catalog.py`、`routes.py`，计算环境 UI 归 `features/resources/`。外部基座用例归 `modules/models/external.py`，无模型依赖的只读文件探针归 `infrastructure/model_probe.py`，登记表单归 `features/models/ExternalBaseForm.tsx`。SSH/SFTP、远程任务与双向传输仍待实现规格补足。现有模块的业务职责继续保留，不因使用云 API 将业务状态搬进供应商客户端。

2026-11-01 增量：`modules/resources/leases.py` 通过包入口公开 `GpuLeases`、`LeaseToken`；业务SQL与迁移0009保存单GPU占用、创建意图和清理事实。仅后端内核，尚未接供应商写操作、Worker、真实Attempt/trial和远程进程。实现及验收边界见[租约内核记录](implementation/gpu-leases-2026-11-01.md)。

2026-11-01 后续增量：`modules/resources/instances.py` 公开 `InstanceLifecycle`、`InstanceSpec`，在资源模块内协调持久参数和租约事实；迁移0010保存创建快照和清理请求/确认。`infrastructure/ucloud.py` 新增显式写客户端 `UCloudInstances`，原 `UCloud.query` 保留只读allowlist。模块共用资源内核事务helper，不跨业务模块移动SQL。尚未接HTTP写入口/Worker/真实Attempt或远程进程。见[实例生命周期记录](implementation/ucloud-instances-2026-11-01.md)。

目录优先回答“这项规则由谁负责”和“修改一项业务要去哪里”。每个 module（模块）通过小而明确的 interface（对外契约）隐藏内部实现。seam（可替换接点）只放在真实需要替换的位置；adapter（适配实现）通过该接点接入。

- 业务纵向组织：数据集规则、持久化和 HTTP 映射放在同一业务模块内，提高 locality（改动集中程度）。
- 进程入口集中：API 与 Worker 入口只负责装配和驱动，共用业务规则。
- 技术接入集中：连接、对象读写、工作目录和子进程机制各有归属；业务状态仍由业务模块拥有。
- 按阶段创建：下方是目标目录，不是当前文件清单；只在功能需要时创建文件和子目录。

## 目标目录

```text
ModelForge/
├── README.md
├── AGENTS.md
├── .gitignore
├── .env.example                    # 公开配置示例；不含真实凭据
├── compose.yaml                    # 开发与单机运行的统一入口
├── docker-db/
│   ├── .gitkeep                    # 空目录占位；数据库内容不进入 Git
│   ├── postgres/                   # Compose 绑定挂载的 PostgreSQL 持久数据
│   └── minio/                      # Compose 绑定挂载的 MinIO 持久对象
│
├── frontend/                       # 一个 React + TypeScript + Vite 工程
│   ├── package.json
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── app/                    # 路由、全局装配和工作台布局
│       ├── features/
│       │   ├── datasets/           # 数据集登记、版本与校验界面
│       │   ├── models/             # 托管模型、外部基座引用和训练产物界面
│       │   ├── training/           # 训练创建、状态、日志和取消界面
│       │   ├── serving/            # 推理服务生命周期与调用界面
│       │   ├── resources/          # 计算环境目录、实例与清理状态界面
│       │   └── overview/           # 工作台只读汇总
│       └── shared/
│           ├── ui/                 # 无业务语义的通用 UI
│           ├── http.ts             # 同源请求、错误处理和取消机制
│           ├── events.ts           # SSE 连接和重连机制
│           └── styles/             # 全局样式与设计 token
│
├── backend/                        # API 与 Worker 共用的一个 Python 工程
│   ├── pyproject.toml
│   ├── migrations/                 # 同一数据库的迁移；不维护独立模块数据库
│   ├── src/modelforge/
│   │   ├── settings.py             # 环境配置解析
│   │   ├── errors.py               # 全局错误基类；业务错误留在所属模块
│   │   ├── bootstrap.py            # 创建依赖、注入执行器和管理资源生命周期
│   │   ├── entrypoints/
│   │   │   ├── api.py              # FastAPI 装配、路由挂载和 HTTP/SSE 入口
│   │   │   └── worker.py           # 单 Worker 循环、信号处理和调度驱动
│   │   ├── modules/
│   │   │   ├── datasets/           # 数据集及不可变版本
│   │   │   ├── models/             # 模型版本、文件清单及可用性
│   │   │   ├── resources/          # 唯一的 GPU 租约规则
│   │   │   ├── training/           # Task、Attempt 及训练执行流程
│   │   │   ├── serving/            # 推理服务状态及运行流程
│   │   │   └── overview/           # 跨模块只读汇总
│   │   ├── infrastructure/
│   │   │   ├── postgres.py         # 连接和事务机制；不收纳全部业务 SQL
│   │   │   ├── minio.py            # 对象上传、下载、校验和删除机制
│   │   │   ├── workspace.py        # 临时目录分配、缓存校验和清理
│   │   │   └── processes.py        # 子进程启动、日志采集、停止和退出确认
│   │   └── runtimes/
│   │       ├── fake_training.py    # 模拟训练执行器；第三阶段引入
│   │       └── vllm.py             # 推理运行时适配；第五阶段引入
│   │                               # 真实训练适配器选型后再命名和创建
│   └── tests/
│       ├── modules/                # 通过模块对外契约验证业务行为
│       ├── integration/            # 真实 PostgreSQL、MinIO 和进程机制
│       ├── entrypoints/            # HTTP/SSE 与 Worker 驱动验证
│       └── fakes/                  # 仅供测试的受控替代实现
│
├── deploy/
│   ├── docker/                     # Web 与后端镜像；API/Worker 复用后端构建
│   └── nginx/                      # 静态托管及 /api、/events 同源代理
├── scripts/                        # 环境检查、迁移和存储校验；复用后端用例
├── tests/
│   └── e2e/                        # 浏览器到 API/Worker 的跨工程闭环
├── docs/                           # 产品、架构、结构、路线和工程流程
├── .scratch/                       # 本地 spec、issues 和探索决策；按需创建
└── .runtime/                       # 临时文件与可重建缓存；排除出 Git
```

保留直观的 `frontend/`、`backend/` 名称。首期两个工程不需要额外的 `apps/`、`packages/` 或多包工作区。`deploy/` 保存镜像及代理配置，根目录 `compose.yaml` 是唯一 Compose 入口。

Compose 的 PostgreSQL 数据目录绑定到 `./docker-db/postgres`，MinIO 数据目录绑定到 `./docker-db/minio`；仅数据库和对象存储容器挂载这两个子目录。它们是 PostgreSQL 和 MinIO 自身的持久化底层文件，不是应用直接使用的正式资产目录。托管模型、数据集和训练产物仍经 MinIO 管理；优云公共基础模型采用[外部只读引用](adr/0002-external-readonly-base-models.md)，不要求复制 MinIO。应用临时工作目录和可重建缓存仍放 `.runtime/`。`docker-db/` 数据内容全部忽略出 Git，只跟踪 `.gitkeep`；Compose 首次启动创建两个数据子目录并执行绑定挂载。

## 后端模块归属

| 模块 | 对外能力示例 | 内部负责的规则 | 留给其他模块的职责 |
|---|---|---|---|
| `datasets` | 登记版本、校验与发布、解析可训练版本 | 数据格式、不可变版本、数据集文件清单及引用保护 | 训练参数、GPU 占用、训练状态 |
| `models` | 登记托管模型和外部只读基座、接收产物、解析可用来源 | 托管文件清单/校验和外部文件指纹、来源血缘、可用状态及引用保护 | 训练状态机、推理进程状态 |
| `resources` | 查询计算环境、关联云实例；获取、续租、释放及核对 GPU 租约 | 供应商实例关联、单 GPU 原子互斥、清理状态、持有者标识及租约代次校验 | 模型内容身份、任务排队、训练结果、推理就绪判断 |
| `training` | 提交、查询、请求取消、推进 Attempt | 输入快照、Task/Attempt、任务领取、训练状态转换、执行流程和错误阶段 | 模型可用性判定、GPU 租约规则的实现 |
| `serving` | 创建、查询、请求停止、推进推理试用生命周期 | 基础模型/Adapter 绑定、单活动请求、流式生成控制、空闲期限、健康与最小推理验证 | 模型登记、GPU 租约规则的实现 |
| `overview` | 查询工作台汇总 | 只读聚合与展示所需投影 | 其他模块的写规则和状态转换 |

`resources` 统一拥有计算环境目录、平台创建的云实例关联及 GPU 租约规则；供应商客户端只提供资源 API 机制。公共模型身份、文件指纹和可训练性归 `models`，不因为目录来自云 API 就重复登记。首期只有一个 Worker，同时最多占用一台单 GPU 实例；训练和推理共用互斥边界，不增加独立租卡或集群调度系统。任务领取仍归 `training`，不把所有后台业务搬进通用 `jobs/`。

`models` 负责托管模型/训练产物的上传、校验和可用版本登记，也负责外部只读基座的来源、文件指纹和执行前核对规则。对外提供明确的文件准备信息和可用性结果；调用者不因来源不同自行绕过校验，`training` 不重复实现模型发布规则。外部基座登记不创建虚假的 MinIO 对象索引。

### 模块内部从小开始

以训练模块的目标形态为例，文件随相关行为出现再拆分：

```text
modules/training/
├── __init__.py       # 仅导出外部需要的用例、结果类型及执行器契约
├── routes.py         # HTTP 参数及结果映射；不实现状态机
├── use_cases.py      # 提交、查询、请求取消和重试
├── execution.py      # Worker 调用的 Attempt 执行流程及状态推进
├── executor.py       # 模块拥有的训练执行器契约
└── persistence.py    # 本模块记录映射、SQL 和原子领取
```

不要求每个模块一开始都有相同文件。小模块可以先把用例和规则放在一个文件；明确出现不同的改动原因后再拆。只做参数转发的 `service.py` 或每张表一层的抽象仓储不作为目录要求。

### 依赖规则

```text
entrypoints → bootstrap → modules / infrastructure / runtimes
entrypoints → modules 的对外契约；API 入口另负责挂载 routes

training → datasets、models、resources
serving  → models、resources
overview → datasets、models、training、serving 的只读契约

runtimes → 所实现的模块契约 + infrastructure 的技术机制
modules  → infrastructure 的连接、对象和工作目录能力
infrastructure → settings / errors / 底层库
```

- 模块间通过对方 `__init__.py` 导出的契约调用。`routes.py` 的挂载由 API 入口负责；运行时仅实现明确导出的执行器契约。
- `datasets`、`models`、`resources` 不反向导入 `training` 或 `serving`。模型血缘中的 Attempt 标识是来源数据，不构成对训练实现的依赖。
- 每个模块拥有自己的表映射和 SQL；跨模块写操作调用对方用例。外键及必要的跨表一致性约束通过统一迁移维护；读取和删除保护的具体并发条件在相关 spec 中明确。
- 需要一起提交的 PostgreSQL 操作复用同一事务上下文，由用例控制提交；各模块不在同一次组合调用中分别提交。
- `infrastructure` 不导入业务模块。对象存储接入不判断模型 available，进程机制不判断训练 succeeded，连接机制不决定租约是否可释放。
- `bootstrap.py` 是具体依赖的装配位置；业务模块不读取全局容器，也不自行创建连接池、MinIO 客户端或运行时。
- API 进程仅装配 HTTP 所需依赖，不创建训练执行器或模型进程。Worker 装配执行器，并在后台执行期间继续处理心跳、取消和服务巡检。

### 接点与测试

训练执行器契约由 `training` 拥有：输入是固定的训练输入和工作目录，输出是运行句柄、进度或退出结果。Fake Executor 与后续真实执行器实现同一契约。推理运行时契约由 `serving` 拥有，vLLM 与测试替代实现通过该接点接入。

运行时报告进程事实和输出清单，不修改平台数据库状态，也不自行登记可用模型。不同执行器的命令行及日志格式留在适配实现内，避免 information leakage（同一实现知识散落在多个模块）。

PostgreSQL、MinIO 和工作目录先使用可注入的具体实现，不为单一实现预建通用存储协议、队列协议或插件系统。业务规则可用受控替代实现验证；事务竞争、租约、校验和及存储失败必须通过真实 PostgreSQL 和 MinIO 的集成验证。不会以 SQLite 或本地正式文件存储替代生产语义。

无 GPU 的开发环境使用明确标识的 Fake Executor 验证任务状态、Worker 调度、取消请求和产物结算的软件流程。可对 PostgreSQL 租约做并发集成测试，但这只证明逻辑互斥，不证明物理设备可用。Fake Executor 不创建训练子进程；真实执行器的子进程启动、日志、停止、退出后释放及 Worker 重启恢复，使用不申请 GPU 的轻量测试进程验证；只有训练结果和训练/推理真实设备互斥必须在有 GPU 的环境验收。两种验证记录分别报告，不互相替代。

## 前端组织规则

一个 feature 是用户能完成的一类业务操作。页面、请求和业务交互放在同一个 feature 中；新增一个训练字段时，优先在 `features/training/` 内完成相应改动。

```text
features/training/
├── index.ts           # 对外导出的页面、选择器或结果类型
├── page.tsx           # 路由页面；多个页面出现后再拆 pages/
├── api.ts             # 训练业务端点和响应映射
├── components/        # 训练专用界面
└── hooks/             # 训练专用交互；实际需要时创建
```

- `app/` 负责路由、全局依赖与布局，调用 feature 的公开入口。
- `shared/` 只保存无业务含义的通用能力。训练状态、模型可用性和数据集格式规则留在 feature 中；前端展示规则不能替代后端校验。
- `http.ts` 处理传输机制，`features/*/api.ts` 处理业务端点；不建立一个收纳全部请求的全局 `services/`。
- `events.ts` 处理 SSE 连接；事件对训练或服务页面的含义由所属 feature 解释。
- `training` 可通过公开入口复用 `datasets`、`models` 的选择能力；`serving` 可复用 `models`。`overview` 使用各 feature 的公开只读能力。依赖方向与后端一致，基础 feature 不反向导入调用者。
- 前端请求和响应类型按 FastAPI 的契约维护；是否生成类型在工具选型时确定，不先增加生成器依赖。
- UI 测试就近放在对应 feature 或通用 UI 旁；跨工程场景放在根目录 `tests/e2e/`。

## 用训练闭环检验设计

以下是模块协作的设计验算，不是运行验证记录。

1. `features/training` 提交数据集版本、基础模型版本和训练参数。API 将请求映射到 `training` 用例。
2. `training` 通过 `datasets` 和 `models` 的对外契约验证输入，保存不可变快照及待执行记录。API 返回任务标识，不启动训练。
3. Worker 驱动 `training` 原子领取待执行记录，通过 `resources` 获取 GPU 租约。无可用 GPU 时保持可解释的等待状态，不启动执行器。
4. `training.execution` 通过 `datasets`、`models` 解析固定版本的文件清单，使用技术接入下载、校验并准备工作目录，再调用注入的执行器。
5. 执行期间由 Worker 持续驱动心跳和控制检查。取消请求写入 PostgreSQL；执行流程通知执行器停止，确认其子进程已退出后才释放对应 GPU 租约。释放必须匹配该次租约的持有者与代次，避免旧执行者释放新租约。
6. 执行器正常退出后，`training` 将产物交给 `models` 登记和校验。必需文件全部在 MinIO 中核验成功后，`models` 才返回可用版本；随后训练用例完成相应结算。GPU 退出事实与产物同步状态分别记录。
7. 前端通过 HTTP/SSE 读取持久化状态。后续 `serving` 仅接受明确可用的模型版本，通过同一个 `resources` 获取 GPU，再驱动推理运行时。

| 失败情形 | 负责模块与设计要求 |
|---|---|
| 数据集无效或模型不可用 | 所属模块返回明确错误，`training` 不进入可执行状态 |
| GPU 被训练或推理占用 | `resources` 拒绝重复占用，用例保留等待或不可启动原因 |
| MinIO 输出上传或校验失败 | `models` 保留不可用状态及失败信息，`training` 记录产物阶段错误；重试不覆盖旧产物 |
| Worker 重启或租约过期 | 租约超时只置为待恢复，不自动视为设备空闲。可通过主机身份、Worker 运行标识、进程 ID 与进程启动时间核验的旧进程须先被确认已退出，再以比较并交换条件释放匹配代次；主机重启、身份不明或无法核验时保留隔离状态，直到安全人工核对 |
| 停止请求已接收但子进程未退出 | 业务保留停止中状态和租约，不先报告取消完成或资源已释放 |
| 本地缓存被清理 | 从 MinIO 按固定版本重新下载和校验；PostgreSQL 不把临时路径当作正式资产标识 |

具体状态枚举、事务隔离、幂等键、SSE 重放和恢复算法在相应 spec 中确定；此处不把尚未实现的协议描述成已完成能力。

## 按阶段创建

| 阶段 | 创建的结构 | 需要获得的验证证据 |
|---|---|---|
| 1. 本地骨架 | 前端入口、`app`、必要的 `shared`；后端两个入口、装配、配置及 PostgreSQL/MinIO 接入；迁移、根目录 Compose、`docker-db/postgres` 与 `docker-db/minio` 绑定挂载和代理 | 两个后端进程可独立启动，前端同源访问 API，迁移可重入，容器重建后 PostgreSQL 数据及 MinIO 对象仍在，MinIO 对象读写校验与删除通过 |
| 2. 数据集 | 两端 `datasets`、后端工作目录能力及相关测试 | 无效数据无法发布，正式版本在清理缓存后仍可从 MinIO 恢复 |
| 3. 模拟训练 | 两端 `training`、后端 `resources`、Fake Executor；`models` 中产物登记所需的最小能力 | 无 GPU 时验证软件任务生命周期、数据库租约互斥和恢复；轻量真实子进程另行验证退出及资源回收，Fake Executor 结果不充当进程或 GPU 证据；模拟产物显式标记，不能当作真实可部署模型 |
| 4. 真实训练 | 选定的真实训练适配实现及所需进程机制，扩充 `models` | 指定 GPU 上受控训练、资源回收及真实产物重新下载后可加载 |
| 5. 推理 | 两端 `serving`、vLLM 适配实现及模型管理界面 | 绑定确切模型版本、健康和最小推理验证、停止无遗留进程、训练推理互斥 |

`overview` 在有实际可展示的数据后添加。模块测试和集成测试随对应实现创建，端到端测试随可运行闭环创建。优云单平台的远程 GPU 执行已纳入产品首版，具体结构待补充；多 Worker、其他云厂商、Redis 和 Kubernetes 继续后置。

## 相对旧布局的变化

| 原布局 | 新归属 | 原因 |
|---|---|---|
| 根包 `api.py`、`worker.py` | `entrypoints/`，共用 `bootstrap.py` | 进程启动方式与业务实现各有位置 |
| 含义宽泛的 `core/` | 明确的 `settings.py`、`errors.py` 及各业务模块 | 全局目录只承接真正全局的内容 |
| `db/` 中混合连接与仓储 | 连接和事务放 `infrastructure/postgres.py`，业务 SQL 放所属模块 | 修改任务规则时能同时找到其持久化行为 |
| 顶层 `storage/` | MinIO/工作目录机制放 `infrastructure`，数据集和模型文件规则各归所属模块 | 存储可用与业务资产可用分别判定 |
| 未明确的 GPU 规则位置 | `modules/resources/` | 训练与推理只维护一份租约规则 |
| 前端并列 `components/`、`lib/` | 业务内容归 feature，通用内容归 `shared/` | 一项业务变更的相关代码集中在同一处 |

最初目录设计轮次仅更新文档及读取入口。后续 ticket 01 已按需实现基础骨架与 Compose；未创建的业务模块继续遵循按阶段创建规则，当前范围与证据见[完整验收记录](implementation/full-compose-2026-10-29.md)。
