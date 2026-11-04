# ModelForge「推理训练」UI/UX 重设计探索

> 阶段：设计探索 / 静态高保真原型  
> 日期：2026-11-04  
> 边界：只修改 `design/inference-training-redesign-2026-11-04/`；不改正式前端、后端、数据库、部署或 Git。原型不连接后端，不产生真实 GPU 费用。

## 先看这里

- 对比门户：[`index.html`](index.html)
- **F4 合并落地版：[`forge-relay.html`](forge-relay.html)**
- F1 铸程线：[`forge-runway.html`](forge-runway.html)
- F2 信号舱：[`signal-deck.html`](signal-deck.html)
- F3 铸造台：[`forge-bench.html`](forge-bench.html)
- 原型可读性增强：[`prototype-readable.js`](prototype-readable.js)
- 本地预览服务：`http://127.0.0.1:4321/`
- 服务未运行时，在 `ModelForge` 根目录执行：

```powershell
python -m http.server 4321 --bind 127.0.0.1 --directory "<project-root>\design\inference-training-redesign-2026-11-04"
```

三份 HTML 也可以直接以本地文件打开；`index.html` 中的截图使用相对路径，直接打开文件同样可查看。

## 1. 范围与依据

仓库没有一个独立叫「推理训练」的路由。本轮把范围界定为：

```text
训练执行 → Best / Final 产物 → 资源回收 → 独立推理试用
```

不包含 `cppt-platform`，不包含新的训练、推理或资源调度能力。

现状判断来自以下真实代码与可运行页面，而不是按截图猜测：

- `frontend/src/app/App.tsx`：全局仍以 `#training`、`#serving` 等 hash 入口切页。
- `frontend/src/features/training/page.tsx`：训练模块内部已有 `?attempt=`、`?view=create`、`?tab=` 查询状态，但它不是跨模块的统一交接协议。
- `frontend/src/features/training/training-model.ts`：可解析训练 Attempt 深链。
- `frontend/src/features/training/components/TrainingWorkbench.tsx`：总览、当前 Attempt、待处理、运行事实和台账同时竞争首屏。
- `frontend/src/features/training/components/AttemptDetail.tsx`：详情页签独立，但“训练结果 / 产物 / 资源回收”仍是多个事实。
- `frontend/src/features/training/components/ArtifactsPanel.tsx`：产物按 Best / Final 读取，但入口本身不携带来源上下文。
- `frontend/src/features/models/AdapterAssets.tsx`：真实入口是 `<a href="#serving">用于推理试用</a>`，没有 `attempt / adapter / role / base_fingerprint`。
- `frontend/src/features/serving/Serving.tsx`：创建表单、试用记录、当前试用、会话和参数全部纵向堆叠；选中 Trial 只存在组件状态，URL 不记录。
- `backend/migrations/versions/0011_execution_workflows.py`：Attempt 状态包含 `waiting_instance`、`running`、`syncing`、`cleanup`、`succeeded` 等，不能用一个绿色“成功”标签代替全部阶段。

真实界面证据：

- `ModelForge/<internal-evidence>`
- `ModelForge/<internal-evidence>`
- `ModelForge/<internal-evidence>`
- `review/baseline/serving-overview-1440.png`
- `review/baseline/serving-detail-1440.png`
- `review/baseline/serving-detail-390.png`

## 2. 现状诊断

### 2.1 任务流程上的核心断点

| 问题 | 证据 | UX 后果 |
|---|---|---|
| 跨模块交接丢上下文 | Adapter 链接只到 `#serving` | 用户从产物进入推理后，还要重新找到同一个 Attempt 和 Adapter |
| 训练结果、产物可用、GPU 释放混在同一套成功语义里 | `succeeded`、`syncing`、`cleanup` 分属不同阶段 | 用户容易把“进程退出”理解成“已可推理” |
| 推理页承担创建、历史、详情、会话四种任务 | `Serving.tsx` 单页顺序堆叠 | 首屏没有唯一主任务；移动端需要长距离滚动 |
| Trial 没有稳定深链 | `selected` 仅存在 React 状态 | 刷新或分享链接后无法回到同一试用记录 |
| 产物组缺少“组级门禁”表达 | Best / Final 分开展示 | 用户容易只选 Best，不知道另一份 Adapter 是否存在 |
| 创建和运行信息层级过密 | 工作台首屏同时有摘要、当前 Attempt、图表、关注项、事实和台账 | 新手先看到数据量，而不是下一步动作 |
| 训练与推理视觉语言不一致 | 训练是蓝白工作台；推理是大表单纵向页面 | 两个模块像不同产品，交接更像重新开案 |
| 移动端动作不稳定 | 队列、详情和固定底栏互相占用空间 | 长页面里主操作与证据不总能同时被看见 |

### 2.2 已经成立的产品事实

- 单用户、本机控制面；无登录、无多租户。
- 收费 GPU 由用户手动创建；平台不代购、不预留。
- 当前只对 `Qwen3-0.6B + 单卡 RTX 4090 + 固定 LLaMA-Factory / vLLM 运行时` 的 partial 基线负责。
- Best 是最低有效验证 Loss；Final 是最终保存点；二者应作为同一发布组验收。
- 训练实例释放、产物可用与推理门禁是三个独立事实。
- 真实样例数据：`1,116 train / 124 val`，`split-4f82b9d1`，基座指纹 `Qwen3-0.6B-20261102-r1`。
- 真实样例 Attempt #7：step 80，Train Loss `0.4362`，Eval Loss `0.3218`，LR `1.64e-4`；Best `0.3218 @ step 80`，Final `0.3389 @ step 168`。

### 2.3 假设

- 桌面是主操作场景，移动端至少能查看状态、完成产物验收和发起一次推理。
- 原型可以使用静态模拟数据表达反馈；不实现 API、SSE 或真实实例状态机。
- F2 深色方向是专业监控概念，不默认要求整站换肤。
- 没有品牌字体包，因此使用系统可用 CJK 字体栈；不是最终品牌字体决策。

## 3. 三个方向

### F1 · 铸程线 / Forge Runway

**视觉主张**：把一次微调当成“可验收的产线”，用暖纸、深森林绿与铜色建立训练子品牌；生命周期轨道贯穿训练、产物与试用。

**核心流程**：冻结输入 → 实例核验 → 训练执行 → 产物验收 `2 / 2` → 资源回收 → 独立推理。每一页右上只有一个「下一步」。

**优点**：

- 最能把“训练到推理”的连续交付讲清楚。
- `Best + Final 2/2` 与“实例已释放”能同时成为可读证据。
- 视觉识别度高，适合作为产品叙事与未来品牌方向。

**代价与风险**：

- 暖纸/铜色与现有冷白/钴蓝产品壳层有断裂，全站迁移成本较高。
- 首屏大标题会压缩工作区；生产版应把已进入运行后的 hero 收为紧凑命令区。
- 线性轨道容易弱化失败、取消、同步中等异步分支，必须保留并行事实和异常断点。

**成本**：中高  
**适用**：首次使用、单次训练验收、需要把“下一步”串成完整故事的主线场景。

### F2 · 信号舱 / Signal Deck

**视觉主张**：训练是信号，不是表单。石墨底、薄荷信号色和三层指令舱把运行索引、信号图、证据检查器放在同一视野。

**核心流程**：选 Run → 读信号 → 切产物门禁 → 带上下文进入验收。

**优点**：

- 高密度运行证据、Loss 曲线、门禁链和资源事实同屏，适合专家值守。
- 图表是主角，能承载多 Run 比较和实时异常判断。
- 三层工作台比“卡片瀑布”更像生产工具。

**代价与风险**：

- 整页深色与现有浅色系统割裂；容易滑向通用 Grafana 运维屏。
- 在移动端，图表、日志、队列和右栏必须重新编排，成本最高。
- 视觉密度会抢走创建、绑定、回收这些关键流程的注意力。

**成本**：高  
**适用**：高频观察、多 Run 对比、异常排查；更适合作为独立分析子视图，而非全站唯一形态。

### F3 · 铸造台 / Forge Bench

**视觉主张**：沿用产品现有冷白、石墨、钴蓝和紧凑控制面，以主从台账 + 控制单驱动。视觉不抢流程，状态与操作保持工业级纪律。

**核心流程**：运行索引 → 选中 Attempt → 运行/指标/日志/产物/试用五页签 → 固定底部主动作。

**优点**：

- 与当前品牌最接近，迁移成本最低。
- 桌面和移动端结构最稳，适合先做生产落地。
- 队列分组、门禁链和冻结清单可复用性高。

**代价与风险**：

- 差异度最低，容易回到“卡片 + 表格 + 按钮”的通用后台。
- 微字和密度偏高；若不压缩首屏信息，仍会重演现状的认知负担。
- 训练与推理的连续性更多依赖交互约定，而不是视觉叙事。

**成本**：低到中  
**适用**：近期生产化、日常值守、已有用户迁移。

### 3.1 视觉系统差异

| | F1 铸程线 | F2 信号舱 | F3 铸造台 |
|---|---|---|---|
| 色彩 | 暖纸 `#f5f1e7`、森林绿 `#1f4f3e`、铜 `#c35b31` | 石墨 `#070a0d`、薄荷 `#6fe2c6`、蓝 `#7ab5ff`、琥珀/珊瑚 | 冷灰 `#edf1f3`、石墨 `#14232b`、钴蓝 `#245ad0`、青绿 |
| 字体 | 宋体大标题 + 系统无衬线 + 等宽数据 | Bahnschrift 窄体 + 等宽数据 | Bahnschrift 半窄体 + 系统无衬线 + 等宽数据 |
| 网格与材质 | 纸张纤维感、细横线、克制阴影 | 深色量测网格、发光被限制为信号点 | 技术蓝图网格、白色面板、细边框 |
| 组件形状 | 4px 小圆角、边框优先 | 近零圆角、分栏与细发丝线 | 2px 小圆角、紧凑面板 |
| 状态语言 | 绿=已验证、铜=当前、琥珀=等待、红=失败 | 薄荷=可用信号、蓝=信息、琥珀=等待、珊瑚=阻断 | 蓝=主动作、绿=通过、琥珀=等待、红=失败 |
| 字号与密度 | 大标题、宽松段落、中密度数据 | 紧凑、高密度、图表优先 | 最紧凑、表格化、组件纪律最强 |
| 动效 | 轻量淡入与状态变化 | 信号与流式文本反馈 | 克制过渡与加载条 |

## 4. 方案对比

评分为 1–5，分数越高越符合该维度；迁移成本分数越高表示越容易落地。

| 维度 | F1 铸程线 | F2 信号舱 | F3 铸造台 |
|---|---:|---:|---:|
| 训练→推理主线表达 | 5 | 4 | 3 |
| 首屏任务效率 | 3.5 | 4.5 | 5 |
| 证据与状态可读性 | 4.5 | 5 | 3.5 |
| 视觉差异化 | 5 | 5 | 2.5 |
| 迁移/实现成本 | 3 | 2 | 5 |
| 移动端稳定性 | 4 | 3 | 5 |
| 总体建议 | **概念主线** | **分析子视图** | **生产降级/落地底座** |

## 5. 子代理分歧与最终决策

### 产品/UX 子代理

- 推荐 F1：只有 F1 把“冻结 → 执行 → 验收 → 释放 → 试用”当作同一条任务。
- 要求补全：产物组 `2/2`、租约释放、失败/取消、空/加载、跨页上下文。
- 担心：线性叙事会掩盖异步分支；移动端需要纵向阶段轨和粘性操作。

### 视觉/UI 子代理

- 推荐 F1：最有产品识别度，且能把交接变成视觉结构。
- 担心：暖纸+绿铜与现有蓝白系统像两个产品；生命周期容易变成装饰长轨。
- 建议吸收：F3 的组件纪律、F2 的证据/曲线能力；F3 作为生产备选。

### 决策

**F1 作为概念主线，F3 作为生产化降级路径，F2 的图表与证据检查器作为分析子视图。**

理由：

1. 用户真正要重新设计的不是“训练页排版”，而是训练结果如何被相信并交给推理。F1 的结构最直接改变这一点。
2. 现有产品底色是冷白与钴蓝，直接全站改成 F1 暖纸风险过高。生产版应保留现有导航与表单，把 F1 的生命周期、证据组和唯一主动作移植进去。
3. F3 已证明高密度控制面能稳定落地，可用它的网格、表格、门禁链和移动底栏；F2 不应成为全站壳层，但它的 Loss 观测与检查器非常适合分析页。
4. 三套原型都没有解决真实后端问题；下一轮应先冻结路由合同和事实字段，再继续视觉深化。

### 5.1 合并结果：F4 合流台

`forge-relay.html` 是上述决策的可交互合并版，不再只是方向提案：

- 保留 F3 的全局控制面、主从运行索引、控制单、右侧门禁链和移动固定主动作。
- 把 F1 的六阶段生命周期改为常驻页头的验收轨，运行、指标、日志、产物、试用五个页签共享同一阶段语义。
- 成功态首屏收敛为一张暖色发布回执，分别确认训练进程退出、Best / Final `2/2`、实例删除与租约释放。
- Best 交接附带 `attempt / adapter / role / base fingerprint`，写入 URL，推理页刷新后仍显示同一交接对象。
- 空工作区不再复用队列数据或伪造“实例核验通过”；加载中也不再显示旧的 DONE 门禁。

## 6. 原型覆盖

### 共同覆盖

- 训练工作台 / 运行队列
- 新建训练（含输入校验）
- 等待手动实例、绑定实例、运行时检查
- 训练执行、指标、日志、产物门禁
- 成功、失败、加载、空状态
- Best / Final `2 / 2` 成组发布
- 带上下文发起独立推理
- 流式回答、停止生成、结束并回收
- 桌面 1440 / 1024 / 768，移动 390

### 三套差异

| | F1 | F2 | F3 |
|---|---|---|---|
| 页面组织 | 单列叙事 + 右侧唯一动作 | 三栏信号工作台 + 检查器 | 主从台账 + 控制单 |
| 产物表达 | 组级发布门禁 + 证据日志 | 双卡门禁 + 资源事实检查器 | 成对发布条 + 交接参数 |
| 推理表达 | 验收对象卡 + 对话 + 安全结束 | 推理通道 + 验收清单 | 对话工作区 + 门禁栏 |
| 移动 | 3×2 导航、两列阶段、底部空间 | 单列信号舱、移动图表 | 抽屉队列、固定主动作栏 |
| 明显风险 | 首屏大标题、品牌迁移 | 深色割裂、信息过载 | 差异度弱、微字过多 |

### F4 合并版覆盖

- 成功首页：发布回执、常驻验收轨、指标、Loss、阶段记录
- 产物页：Best / Final `2/2`、资源释放、交接合同
- 推理页：交接凭据、流式对话、停止生成、验收清单、安全回收
- 创建、等待、训练、失败、空、加载状态沿用同一套流程与组件
- 桌面 1440 / 1024 / 768，移动 390

## 7. 截图索引

### F4

- `review/showcase/01-f4-relay-running-1440.png`
- `review/showcase/02-f4-relay-success-1440.png`
- `review/showcase/03-f4-relay-artifacts-1440.png`
- `review/showcase/04-f4-relay-create-1440.png`
- `review/showcase/05-f4-relay-inference-1440.png`
- `review/showcase/06-f4-relay-mobile-390.png`

### F1

- `review/showcase/01-f1-runway-running-1440.png`
- `review/showcase/02-f1-runway-success-1440.png`
- `review/showcase/03-f1-runway-create-1440.png`
- `review/showcase/04-f1-runway-inference-1440.png`
- `review/showcase/05-f1-runway-mobile-390.png`

### F2

- `review/showcase/01-f2-signal-running-1440.png`
- `review/showcase/02-f2-signal-success-1440.png`
- `review/showcase/03-f2-signal-create-1440.png`
- `review/showcase/04-f2-signal-inference-1440.png`
- `review/showcase/05-f2-signal-mobile-390.png`

### F3

- `review/showcase/01-f3-bench-running-1440.png`
- `review/showcase/02-f3-bench-success-1440.png`
- `review/showcase/03-f3-bench-create-1440.png`
- `review/showcase/04-f3-bench-inference-1440.png`
- `review/showcase/05-f3-bench-mobile-390.png`

`review/states/` 另有 running / success / waiting / loading / empty / error，以及 F3 的 trial_error 状态截图。

F4 的对应状态截图位于 `review/states/f4-*-1440.png`。

## 8. 验证结果

### 自动化

```text
node design/inference-training-redesign-2026-11-04/scripts/verify-prototypes.mjs
node design/inference-training-redesign-2026-11-04/scripts/verify-relay.mjs
```

- 布局 sweep：1440 / 1024 / 768 / 390，无横向溢出，每页恰好一个 `h1`。
- 交互回归：10 / 10 通过。
- F4 交互回归：9 / 9 通过，包含直接双击 HTML 文件打开的路径。
- 页面运行时错误：`consoleErrors = []`。
- 覆盖创建校验、等待实例、绑定实例、产物交接、聊天流式、停止生成、日志筛选、取消/回收弹窗、移动端队列关闭。
- F4 额外覆盖发布回执、验收轨跳转、URL 恢复推理上下文、空工作区门禁一致性和移动端交接。

```text
node design/inference-training-redesign-2026-11-04/scripts/capture-showcase.mjs
node design/inference-training-redesign-2026-11-04/scripts/capture-relay.mjs
```

- 生成 20 张展示截图（含评审入口与 3 张移动端整页图）、19 张状态截图。
- F4 另生成 6 张展示截图和 7 张状态截图。
- 最终运行 `errors = []`。
- 使用 headless Chrome / Playwright；不使用 `bringToFront`，不抢占桌面焦点。

### 设计检查

以 URL 渲染态运行 `impeccable detect` 后：

- F2 / F3：`0` 项主告警；技术网格背景仍作为 advisory 保留。
- F1：仅剩 `cream-palette` 一项主告警。暖纸是本方向的有意视觉主张，不是误用模板色；详见第 3 节。
- F4：`0` 项主告警；仅保留控制面技术网格的 advisory。
- 三个原型统一加入 12px 最小可读字号层，用于纠正高密度表格、时间码和状态标签中低于可读阈值的微字。
- 评审对比页仍有 4 项 `cramped-padding`，来自截图框与数字栏的贴边布局；该页是评审材料而非产品界面，保留其图版式。
- 没有把上述结果等同于完整 WCAG 审计；生产化前仍须做键盘、读屏和对比度全量复核。

## 9. 下一轮建议

### P0 · 先定合同，不先换皮

1. 定义统一交接合同：`attempt_id / adapter_id / role / base_fingerprint / action`。
2. `#serving` 支持稳定 Trial 深链；训练保留 `?attempt=`，推理补 `?trial=`，刷新可恢复。
3. 拆出三项状态：`training_outcome`、`artifact_pair_ready`、`lease_released`；文案和颜色不得互相代替。
4. 创建试用不再从“全量 Adapter”开始；有合法交接时，只显示本次对象并核对；无上下文时才回退到选择。

### P1 · 以 F4 为生产首版，不再另起方向

1. 保留现有蓝色全局导航；F1 的森林绿/铜色只进入训练子域，避免整站换品牌。
2. 已进入运行后，将 F1 大标题折叠为紧凑命令栏，把 80% 首屏留给当前 Attempt、门禁与下一步。
3. 产物页固定为一个组：Best + Final `2/2`，分开显示“可用”“已上传”“待同步”，不把 `1/2` 包装成成功。
4. 推理页改为「对象核对 + 对话」主视图；试用历史收进抽屉或列表，创建动作降为次要入口。
5. 移动端采用 F3 固定主动作栏 + 足够底部留白，F1 的概念只保留在阶段轨和对象证据，不照搬桌面 hero。

### P2 · 再补分析能力

- 仅在指标/分析页使用 F2 的连续 Loss、Best 标记、采样边界和检查器。
- 不伪造显存、总步数、准确率或未上报指标。
- 推理验收增加固定问题计数与“证据已记录”，不要只显示 Loss。

## 10. 明确未完成

- 未改正式 `frontend/src`、后端、数据库、部署。
- 未接 API、SSE、MinIO、vLLM。
- 未运行真实训练、GPU、实例创建或推理。
- 未提交 Git、未部署、未发布。
- 未做完整 WCAG 审计；只检查了布局、主要交互、单主标题、运行时错误和设计 detector。

