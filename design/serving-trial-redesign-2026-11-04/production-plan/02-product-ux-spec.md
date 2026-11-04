# Serving F1.1 产品与 UX 规格

Status: planning-only  
Target: ModelForge「推理试用 / Serving」  
Production baseline: F1.1 Trial Workbench

## 1. 目标用户与核心任务

### 主要用户

完成 LoRA 训练后，需要判断 Best / Final Adapter 是否可交付的算法工程师。

他们最关心四个问题：

1. 这个 Trial 用的是哪个基座、哪个 Adapter、哪个实例？
2. 服务现在是否 ready，为什么不能发消息？
3. 这次生成是否完整，停止后哪些内容仍可用于当前页面对话？
4. 结束试用后，运行进程、云实例和 GPU 租约是否真的回收？

### 次要用户

负责实例和运行故障排查的平台管理员。管理员需要看到进程退出码、实例清理失败码、租约状态和生命周期事件，但这些事实不应占据普通用户的默认视野。

### 核心任务

> 选一个 Trial，确认它绑定了什么，完成一次真实对话，然后安全地结束。

## 2. 现状问题

现有 `frontend/src/features/serving/Serving.tsx` 已验证存在以下问题：

- 创建表单、试用记录、详情、会话和结束回收纵向堆叠，11 个实例表单控件（含 10 个持久字段）占据首屏。
- Trial 没有可复制、可刷新恢复的 URL。
- `state`、`request_state`、`stop_requested` 三套原始状态直接暴露，用户需要自行推导可执行动作。
- 顶部错误条与具体操作距离过远。
- 结束回收没有确认，也没有区分“已请求停止”和“已确认回收”。
- 移动端记录表横向溢出，会话与结束动作位置过深。
- 创建实例必须由用户先在优云控制台完成；平台不会自动购买。这个关键约束容易被普通表单淹没。

## 3. 信息架构

页面保持左侧 ModelForge 主导航不变。`#serving` 页面内部采用三段式工作台。

```text
页面头
├── 标题 / 当前 Trial 摘要
├── 队列筛选（P1）
└── 新建试用

工作区
├── 左栏：Trial 队列
│   ├── 当前选中
│   ├── 需处理
│   ├── 进行中
│   └── 已结束
├── 中栏：当前 Trial
│   ├── 当前 Trial 标题与统一状态
│   ├── 创建 / 等待绑定 / 准备失败等状态页
│   ├── 会话记录
│   ├── 参数折叠区
│   └── 输入区 / 生成控制
└── 右栏：运行对象与动作
    ├── Adapter / 基座 / 指纹
    ├── 实例与空闲回收
    ├── 准备检查
    ├── 结束试用
    └── 生命周期回执（结束或异常时）
```

创建、绑定和结束确认使用弹层或侧栏，不把主工作区继续向下拉长。

## 4. 入口与 URL

### 页面入口

- 左侧导航入口仍为 `#serving`。
- 从列表选择一个 Trial 后，URL 使用 `?trial=<trial-id>#serving`。
- 新建弹层使用 `?view=create#serving`，可保留当前 `trial`。
- 刷新页面必须恢复 `trial` 和 `view`。
- 浏览器前进/后退必须恢复对应 Trial 和创建弹层状态。

### 无选中 Trial

展示工作区空状态：

- 标题：“选择一个试用记录，或新建试用。”
- 主操作：“新建试用”。
- 次操作：“刷新队列”。
- 不自动挑一条 Trial 并悄悄改写 URL。

### URL 指向不存在 Trial

- 保留 URL，不清空到列表首条。
- 显示“找不到这条试用记录”。
- 提供“回到队列”和“复制试用 ID”。
- 不把 404 文案原样当作状态徽标。

## 5. F1.1 主流程

```text
进入 #serving
  → 读取队列
  → 选择 Trial / 刷新恢复 URL
  → queued
  → waiting_instance
      → 查看见解要求
      → 前往优云手动创建独立实例
      → 填写实例 ID + 授权清理
  → preparing
      → 运行时校验 / 模型与 Adapter 准备
  → ready
      → 会话
      → 生成
      → 完成 / 停止生成
      → 继续对话 / 清空页面会话
  → 结束确认
      → 提交停止请求
      → 等待进程退出
      → 等待实例删除
      → 等待租约释放
  → 回收事实完整：已结束
    回收事实不完整：已结束，待核对
```

异常路径：

```text
preparing → blocked
生成中 → 停止生成
生成中断 / request_state=unknown
结束中 → 实例删除失败
结束中 → 实例已删除但租约未释放
状态轮询失败 → 保留上一次数据并标记“已过期”
```

## 6. 用户可执行状态

界面不直接并列展示原始枚举。`serving-model.ts` 必须派生为以下单一状态。

| UI 状态 | 判定依据 | 主文案 | 可执行动作 | 可发送 |
|---|---|---|---|---|
| `loading` | 首次详情尚未返回 | 正在读取试用 | 取消返回队列 | 否 |
| `invalid_route` | Trial ID 无效或 `404` | 找不到这条试用记录 | 回到队列、复制 ID | 否 |
| `queued` | `state=queued` | 已创建，等待分配 GPU | 刷新、结束 | 否 |
| `waiting_instance` | `state=waiting_instance` | 请手动创建并绑定实例 | 查看要求、绑定实例、结束 | 否 |
| `preparing` | `state=preparing` | 正在校验并启动推理 | 刷新、查看详情、结束 | 否 |
| `ready` | `state=ready` 且 `request_state=idle` | 可以开始试用 | 发送、清空会话、结束 | 是 |
| `generating` | `request_state=running` | 正在生成 | 停止生成、查看部分输出 | 否 |
| `cancelling` | `request_state=cancelling` 或 `request_cancel_requested=true` | 正在停止本次生成 | 等待确认、刷新 | 否 |
| `request_unknown` | `request_state=unknown` | 无法确认上一次生成是否结束 | 刷新、查看运行事实 | 否 |
| `ending` | `stop_requested=true` 或 `state=stopping` | 正在结束并回收 | 查看回执、刷新 | 否 |
| `blocked` | `state=blocked` 或错误阻止继续 | 需要处理后才能继续 | 查看错误、复制事实、结束/回收 | 否 |
| `ended` | `state=stopped` 且回收事实完整 | 已结束，实例已回收 | 查看回执、新建试用 | 否 |
| `ended_incomplete` | `state=stopped` 但事实缺失/不完整 | 已结束，回收事实待核对 | 查看回执、刷新 | 否 |
| `unknown` | 未识别枚举或缺关键字段 | 状态待确认 | 刷新、查看原始事实 | 否 |

### 状态优先级

为避免状态互相覆盖，按以下顺序派生：

1. 路由错误 / `404`
2. `state=blocked`
3. `state=stopped`（再根据生命周期分完整、未占用、待核对）
4. `request_state=unknown`
5. `stop_requested=true` 或 `state=stopping`
6. `request_state=cancelling` 或 `request_cancel_requested=true`
7. `request_state=running`
8. `waiting_instance`
9. `preparing`
10. `queued`
11. `ready + idle`
12. 未知兜底

`stopped` 是否显示为绿色完成态必须由生命周期回执再判定，不能只看顶级 `state`。

### 结束中的子事实

`ending` 不能只有一个转圈。右栏按可获得事实显示：

1. **停止请求已提交**：`stop_requested=true`，尚无退出事实。
2. **推理进程已退出**：`lifecycle.process.state=exited`，展示退出码。
3. **实例正在回收**：清理已允许或实例状态为 `stopped`。
4. **实例已删除**：`lifecycle.instance.state=deleted`。
5. **GPU 租约已释放**：`lifecycle.lease.state=released`。

只有第 4、5 项、`lifecycle.cleanup.state=confirmed` 和“进程事实不是 `unknown`”同时成立，才显示“已结束，实例已回收”。

## 7. 创建试用

### 入口

- 页面头“新建试用”。
- 空状态主按钮。
- `?view=create#serving` 可直接打开。

### 弹层结构

弹层使用三步渐进披露，所有原字段必须保留。

#### 第 1 步：选择 Adapter

- 只显示 `state=available` 的 Best / Final Adapter。
- 每项显示角色、来源 Attempt 短 ID、`eval_loss`、基座版本、Adapter 指纹前 12 位。
- 不兼容项显示原因并禁用，不隐藏。
- 必选校验发生在弹层内，不使用页面顶部错误条。

#### 第 2 步：确定单 GPU 实例要求

基础项：

- 地域 `region`
- 可用区 `zone`
- GPU `gpu_type`
- CPU / 内存 `cpu`、`memory_mb`
- 运行镜像 `image_id`
- 镜像目录与名称筛选仅作为选择运行镜像的辅助控件，不新增持久字段。

高级项：

- CPU 平台 `cpu_platform`
- 系统盘容量 `boot_disk_gb`
- 磁盘类型 `boot_disk_type`
- 计费方式 `charge_type`

`InstanceSpec` 实际包含 10 个持久字段；界面中的“镜像目录”和“筛选镜像”是选择 `image_id` 的两个辅助控件，因此当前表单共有 11 个控件。不得把辅助控件误计为持久字段，也不得删除任何持久字段。

字段依赖保持：

```text
地域 → 可用区 → GPU → CPU/内存
可用区 → 镜像目录 / 筛选 / 运行镜像
```

不得为了缩小表单而删除任何 `InstanceSpec` 字段。

#### 第 3 步：确认手动创建

沿用 `ManualInstanceDialog` 的真实约束：

- 平台只保存单 GPU 要求。
- 平台不会调用优云创建接口。
- 平台不会自动购买或预留资源。
- 用户必须自行创建一台独立于训练的新实例，并在 Running 后回到平台绑定。

创建成功后的结果：

- 关闭弹层。
- 以 `history.pushState` 进入新 Trial 的 `?trial=<id>#serving`。
- 立即显示 `waiting_instance`。
- 显示下一步“前往优云控制台创建实例并返回绑定”。

### 创建错误

- 字段错误放在字段组内。
- `gpu_busy` 显示“已有训练或试用持有 GPU”；不提供“仍然创建”绕过。
- `base_region_mismatch` 指明基座要求的地域。
- 网络错误保留表单输入，提供原操作重试。
- 提交中禁用重复提交，但保留取消/返回。

## 8. 手动实例绑定

### 绑定面板内容

- Trial 短 ID。
- 完整实例要求，从 `snapshot.instance` 读取，不用临时表单状态替代。
- 实例 ID 输入，客户端先校验 `^[A-Za-z0-9_-]+$`。
- 明确勾选“我拥有此实例，并授权平台在结束后停止、删除”。
- 固定提示：“不要绑定正在用于训练的实例。”

### 成功后

- 以接口返回值立即更新详情。
- 进入 `preparing`。
- 显示运行时校验、模型准备、Adapter 指纹准备、健康探测等步骤。
- 轮询失败时保留已显示步骤，标记数据已过期，不伪造新进度。

### 绑定错误

- 空值、格式错误在输入框下方。
- `trial_not_waiting`：提示队列状态已变化，刷新后重新操作。
- `gpu_instance_conflict` / `gpu_creation_conflict`：显示实例不可重新绑定。
- 服务端错误码原样保留在可展开详情中。

## 9. 会话与生成

### 会话生命周期

- 会话仅保存在当前页面。
- 切换 Trial、刷新、离开页面会清空本地会话。
- 页面需持续显示“会话仅保存在当前页面，刷新后清空”的短提示。
- 清空会话只清浏览器状态，不取消请求，不删除服务端 Trial。

### 空会话

显示：

- “开始一次真实生成。”
- “固定验收问题”按钮组，仅点击填入输入框，不自动发送。
- 会话边界说明：“部分输出会留在本页，但不会作为下一轮上下文。”

建议问题使用真实验收语义，不使用 Lorem Ipsum：

1. “请用三条要点说明你能协助的业务范围，以及不应由你替代人工判断的情况。”
2. “用户要求对一笔已超过退款期限的订单直接退款。请说明规则边界并给出下一步建议。”
3. “请复述输入中不存在的订单号；如果无法确认，请明确拒绝编造。”

### 输入区

- 文本长度上限来自 `runtime.inference.conversation.max_content_chars_per_message`。
- 参数 `max_tokens`、`temperature`、`top_p` 放在可折叠“生成参数”中。
- 默认值来自 runtime baseline。
- 发送按钮仅在 `ready + idle + 非空` 时可用。
- Enter 发送、Shift+Enter 换行仅在桌面端启用；移动端不强制。

### 流式生成

- 用户消息立即进入会话。
- 助手消息先显示“正在等待输出…”，再增量追加。
- `done` 且未取消：标记完成，可进入下一轮上下文。
- `done` 且 `partial=true`：显示“部分输出”，不进入下一轮请求上下文。
- SSE 中断：保留已收到的部分输出，标记“结果尚未确认”。
- `request_state=unknown`：禁止再次发送，直到详情刷新显示 `idle`。

### 停止生成

- 按钮立即变为“正在停止生成…”并禁用重复提交。
- 调用 `POST /api/v1/serving/trials/{id}/cancel-request`。
- 只有收到 `done(partial)` 或详情显示请求结束，才结束“停止中”状态。
- 停止生成本身不等于结束试用，不清空实例。

## 10. 结束试用与回收回执

### 结束确认

点击“结束试用并回收实例”必须先显示确认弹层，包含：

- Trial 短 ID。
- Adapter 角色和来源 Attempt。
- 实例 ID；尚未绑定则显示“尚未绑定实例”。
- 当前是否有生成请求。
- 明确后果：“结束试用会停止当前生成；平台将按已授权清理策略停止并删除绑定的实例。只有回收事实确认后才会显示成功。”

主按钮使用危险色：“结束试用并回收”。取消按钮保持安全焦点。

### 回收回执

回执使用四层事实，不用一条模糊进度条代替：

| 层 | 可接受事实 | 未完成文案 |
|---|---|---|
| 停止请求 | `stop_requested=true` | 尚未提交 |
| 运行进程 | `process.state=exited` + `exit_code` | 等待进程退出 / 状态未知 |
| 云实例 | `instance.state=deleted` | 等待实例删除 |
| GPU 租约 | `lease.state=released` + `released_at` | 仍被平台持有 |

清理策略和错误码只读显示：

- `cleanup.policy=discard|outputs_persisted`
- `cleanup.state=not_requested|pending|failed|confirmed`
- `cleanup.error_code=instance_delete_failed`

### 不完整结束

当 `state=stopped` 但事实不完整：

- 标题必须是“已结束，回收事实待核对”，不能是绿色“回收成功”。
- 显示缺失项，而不是推测“应该已经释放”。
- 显示“平台会继续对账”；提供刷新与复制实例 ID。
- 不提供重复 `stop`、伪造重试或“强制释放”按钮。
- 如果租约仍为 `held`，提醒新 Trial 可能因 `gpu_busy` 无法创建。

### 未占用实例的结束

如果 Trial 从未获得租约，只有生命周期 `status=not_reserved` 与 `state=stopped` 同时成立，才可使用“已结束 · 未占用实例”。

如果 Trial 曾持有租约但在创建/启动实例前结束，必须同时满足 `creation.state=not_requested`、`instance.state=none`、`process.state=not_started`、`cleanup.state=not_requested`、`lease.state=released`，才可使用“已结束 · 未创建云实例”。不能仅凭 `instance_id` 为空推断。

## 11. 队列

### P0

- 数据来自 `GET /api/v1/serving/trials`，保留后端最多 200 条的上限。
- 每项显示短 ID、统一状态、Adapter 角色与来源 Attempt、实例短 ID、更新时间。
- 点击整项切换 Trial，键盘使用原生 button。
- 当前项使用 `aria-current="true"`，不只靠背景色。
- 队列刷新不改变当前选择，不抢焦点，不把列表滚动到顶部。

### P1

- 过滤：全部、需关注、进行中、已结束。
- 搜索：Trial 短 ID、Adapter 来源、实例 ID。
- 排序：当前项固定；其余按需处理 → 生成中 → ready → 准备/等待 → 结束中 → 已结束；同组按更新时间倒序。
- 筛选条件不上 URL，除非另开范围。
- 200 条上限在队列底部明确说明。

## 12. 错误与反馈

- 页面级错误用于队列整体不可用或服务状态过期。
- 操作错误就近显示在创建、绑定、发送、结束区域内。
- 错误必须同时包含：中文结论、可执行下一步、原始错误码。
- 局部刷新失败不清空已有详情；显示“数据已过期”和最后成功时间。
- Toast 只用于短时成功确认，不承载不可恢复错误。
- 404 与 422/409 分开处理，不把请求错误描述成试用状态。

## 13. 响应式行为

| 宽度 | 队列 | 主会话 | 运行事实 |
|---|---|---|---|
| `>= 1180px` | 左栏固定 | 中部 | 右栏固定 |
| `1024–1179px` | 左侧窄栏 | 中部 | 右侧抽屉 |
| `768–1023px` | 抽屉 | 中部 | 抽屉 |
| `641–767px` | 顶部按钮打开抽屉 | 全宽 | 抽屉 |
| `<= 640px` | 顶部队列按钮 | 全宽、底部固定输入区 | 运行事实抽屉 |

移动端必须：

- 无横向表格；队列改为列表按钮。
- 状态条、队列入口、运行事实入口在首屏可见。
- 输入区不被原型状态切换器或浮层遮挡。
- 抽屉可用 Escape 关闭，焦点返回触发按钮。
- 结束动作放在运行事实抽屉，但滚动路径不超过一个抽屉。

## 14. 文案与假设

### 视觉与品牌假设

- 延续现有 ModelForge 浅色蓝灰工作台，不做整站深色换肤。
- 主用户具备模型训练基础知识，但不应被要求理解数据库枚举。
- “已回收”只能描述平台已获得确认的事实。

### 已知非目标

- 不持久化聊天历史。
- 不新增多用户、权限、远程访问或生产部署。
- 不实现模型并排 A/B 对比。
- 不新增自动购买、启动或删除未绑定云资源的能力。
- 不在 P0 持久化人工“有用 / 偏题 / 不安全”评级。
- 不修改 Worker 状态机、GPU 租约规则或数据库枚举。

## 15. UI 验收口径

用户应能在不展开原始 JSON 的情况下完成主流程，同时能在异常时找到事实。任何一项原始状态被重新并列显示、任何“停止请求已提交”被写成“实例已回收”、任何创建字段在没有替代路径时被删除，都视为不满足本规格。
