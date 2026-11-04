# 下拉控件可见性与同类问题审计

Status: fixed-local / browser-verified  
Date: 2026-11-04  
Scope: `frontend/src/shared/SelectMenu.tsx`、`frontend/src/shared/styles/controls.css`，以及共享下拉的实际使用页面  
Evidence: `../review/select-audit-2026-11-04/`

## 1. 结论

「推理试用 / 创建独立推理试用」里的 Adapter 下拉不是没有 CSS，也不是选项数据缺失。
真正原因是弹层层级错误：

1. 创建弹层使用原生 `<dialog>.showModal()`，进入浏览器 top layer。
2. `SelectMenu` 将浮层通过 `createPortal(..., document.body)` 挂到 body。
3. 浮层 DOM 确实存在，尺寸、白底、边框、阴影和 6 个选项也都存在。
4. 但 body 子节点位于打开的 dialog 与 backdrop 之下，视觉上被完全盖住。

因此此前看到的是“点击后没有任何下拉展开”的假空状态，而不是缺少 option 样式。

## 2. 修复

### 2.1 Portal 目标

`SelectMenu` 现在优先把浮层挂到触发器最近的、处于打开状态的 `<dialog>`：

```ts
const portalTarget = open && triggerRef.current
  ? triggerRef.current.closest<HTMLDialogElement>('dialog[open]') ?? document.body
  : document.body;
```

弹层外、普通页面上的下拉仍挂到 `document.body`；弹层内下拉与 dialog 共享 top layer，
不会再被 dialog 或 backdrop 覆盖。

### 2.2 选项状态

共享控件补充了可扫描的选项状态：

- 当前键盘焦点：淡蓝背景、左侧强调线、描边。
- 当前已选值：淡背景、加粗，并显示「已选」。
- 禁用选项：独立底色、降低强调，并显示「不可选」。
- 选项最小高度 40px；状态标签 11px / 最小 20px。
- 保留 dark theme、hover、focus-visible、reduced-motion。

这里没有把全部原生 `<select>` 批量替换为自定义控件。原因是原生控件在普通页面已有各自样式，
且替换会影响表单语义、移动端原生选择器和键盘行为；本轮只修复会真实遮挡内容的层级问题，
并把统一控件作为后续设计系统任务。

## 3. 修复前后证据

| 场景 | 修复前 | 修复后 |
|---|---|---|
| Adapter 下拉，1440 | `before-adapter-1440.png`：DOM 有 772×305 白底浮层，截图不可见 | `after-adapter-1440.png`：浮层完整可见，6 项都在 |
| CPU 平台下拉，1440 | `before-platform-1440.png`：同样被 dialog 盖住 | `after-platform-1440.png`：可见并显示「Auto / 已选」 |
| Adapter 下拉，390 | `before-adapter-390.png`：不可见 | `after-adapter-390.png`：340px 宽，横向不溢出 |
| 键盘焦点 | — | `after-keyboard-active-1440.png`：第二项成为当前焦点 |
| 键盘选择完成 | — | `after-adapter-selected-1440.png`：触发器显示已选 Adapter，焦点回到触发器 |
| 训练页同类下拉 | — | `other-training-dataset-1440.png`、`other-training-filter-1440.png` |
| 训练日志深色下拉 | — | `other-training-logs-dark-1440.png`：背景 `rgb(17, 27, 43)`，全部选项 40px，无溢出 |

修复后的结构断言：

```text
popover.parentElement.tag = dialog
popover.parentElement.open = true
adapter desktop = 772 × 325
platform desktop = 368 × 136
adapter mobile = 340 × 339
document.documentElement.scrollWidth = 390
window.innerWidth = 390
consoleErrors = []
pageErrors = []
```

键盘断言：

```text
ArrowDown #1 -> Best · Attempt 03c13388
ArrowDown #2 -> Final · Attempt 02504b93（跳过两个禁用项）
Escape -> 浮层关闭，焦点回到「已同步 Adapter」
Enter -> 选中 Final · Attempt 03c13388，expanded=false，焦点保持在触发器
```

## 4. 同类控件审计

项目内共享 `SelectMenu` 出现在：

- 推理试用创建弹层；
- 训练创建页的数据版本、基础模型和实例规格；
- 训练工作台状态筛选；
- 训练日志级别筛选；
- 计算环境实例字段。

实测结论：

| 位置 | 挂载点 | 结论 |
|---|---|---|
| 推理试用创建弹层 | `dialog[open]` | 已修复，核心问题所在 |
| 训练创建页 | `body` | 正常，选项 40px，无横向溢出 |
| 训练工作台筛选 | `body` | 正常，已选项显示「已选」，无横向溢出 |
| 训练日志级别筛选 | `body`，`theme="dark"` | 正常，深色浮层与选项状态一致，无横向溢出 |

原生 `<select>` 审计：

- 模型页筛选：有 40px 高、边框、圆角和焦点环；`appearance:auto`，展开列表由浏览器/系统绘制。
- 计算环境页：8 个原生 select；有 44px 高、边框、圆角、自绘箭头和禁用态。
- 这些控件都不在打开的 dialog 内，不存在本轮 top-layer 遮挡问题。

剩余差异不是 bug，但属于设计系统一致性问题：原生 option 的展开样式由操作系统控制，
无法与 `SelectMenu` 的「已选 / 不可选」状态完全一致。若下一轮要做全站控件统一，
应按页面逐步替换并补齐原生表单语义、移动端和键盘回归，不应一次性全局替换。

## 5. 自动化与构建

| 检查 | 结果 |
|---|---|
| `npm test` | 69 / 69 passed |
| `npm run build` | pass |
| Compose `web` 重建 | pass |
| `docker compose ps` | `api/web/worker/postgres/minio` 全部运行 |
| 浏览器 console/runtime error | `[]` |

构建仍只有既存提示：`index-*.js` 约 633 kB，与本轮下拉修复无关。

## 6. 边界

- 本轮只修改共享下拉组件和样式，未修改正式后端、数据库、Worker、Trial 状态机或云资源。
- 截图来自本地 Docker 预览和真实浏览器 DOM；不是设计概念图。
- 真实 GPU 推理闭环仍为 `BLOCKED`，与本轮纯前端控件修复无关。
- 未提交 Git、未 push、未部署到远程环境。
