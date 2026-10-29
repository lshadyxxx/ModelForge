# 连续流程原型检查记录

时间：2026-10-28 至 2026-10-29，Asia/Shanghai。对象：`designs/modelforge-mvp/` 连续流程静态原型。设计状态：`needs-review`。

通过 ego-browser 在本机静态预览实际点击；不是直接修改页面状态来制造成功。应用实现、数据库、对象存储、优云和 GPU 验收均未执行。

## 实际观察

| 检查 | 观察结果 | 证据 |
|---|---|---|
| 正常连续路径 | 选择输入、资源、参数后提交；阶段完成、Best/Final 可选；独立实例准备后可多轮对话和回收。 | [最终读回](final-flow-observations.json) |
| 缺少输入、未知镜像、库存失效 | 留在相应步骤并提示原因；库存恢复后可继续。 | [最终读回](final-flow-observations.json) |
| 训练参数越界 | 轮数 0 被阻止，参数页错误提示保留；修正为 3 后可继续。 | [参数与窄屏](wizard-observations.json) |
| 草稿返回与高级参数 | 前后切换保留 rank、Batch 等选择，确认页显示有效 Batch 与固定拆分。 | 浏览器实际点击；[提交页截图](submit-desktop.png) |
| 指标与 Best/Final | 3 epoch 对应 3 个验证点，Best epoch 2 / 1.490、Final epoch 3 / 1.560；横轴显示进度。全部是示例。 | [指标读回](metric-observations.json)、[产物截图](artifacts-desktop.png) |
| 训练失败、重试、取消 | 失败不发布部分 Adapter；新 Attempt 保留旧记录及同一拆分；取消完成后 GPU 显示可申请。 | [Attempt 读回](attempt-observations.json) |
| 训练回传失败 | 已成功退出时不再显示取消按钮，实例保留；试用按钮禁用，恢复回传后可继续清理。 | 实际点击核对；[阶段/产物截图](artifacts-desktop.png)为恢复后的状态 |
| 训练实例清理失败 | 正式产物可用但 GPU 仍占用，试用被阻止；重试核对删除后释放。 | [Attempt 读回](attempt-observations.json) |
| 推理指纹错误 | 未出现聊天输入，显示不一致原因；重新核对恢复后进入聊天。 | 浏览器实际点击；不作为真实指纹校验测试 |
| 流式停止与多轮 | 中途停止保留“部分回复”标记且实例可继续；两轮后有 4 条消息；清空消息保留实例。 | [最终读回](final-flow-observations.json)、[对话截图](chat-desktop.png) |
| 结束与删除失败恢复 | 删除未确认时禁止聊天且 GPU 保持占用；重试后显示可申请。 | [回收读回](lifecycle-observations.json)、[清理失败截图](cleanup-error-desktop.png) |
| 空闲回收 | 用原型控制快进无请求空闲 15 分钟；进入回收并确认结束。 | [最终读回](final-flow-observations.json) |
| 数据校验与发布 | 错误样例显示第 3 行及 messages[1].content，发布不可用；有效样例可发布。 | [数据/导入读回](data-import-observations.json) |
| 模型上传恢复 | 两个已校验文件显示可复用，失败权重文件重传后校验完成。 | [数据/导入读回](data-import-observations.json) |
| 六入口、任务列表、模型产物库 | 可进入各入口，两个演示任务分别显示；最终版本模型产物库可跳到对应 Task 的 Best/Final。 | [数据/导入读回](data-import-observations.json)、[最终读回](final-flow-observations.json) |
| 390 × 844 窄屏 | 工作台与参数步骤文档 scrollWidth 为 390；六入口显示。桌面和窄屏均保存截图。 | [参数与窄屏](wizard-observations.json)、[工作台窄屏](workbench-mobile.png)、[参数窄屏](wizard-mobile.png) |

截图用于审阅，未宣称全页面像素或完整无障碍验收通过。当前工作台与计算环境选择页截图已检查布局；其余视图以浏览器 DOM 状态、尺寸和截图留存为证据，仍需用户审阅具体视觉效果。计算环境选择页的浏览器错误/警告日志读回为空，这不替代完整运行时日志测试。

## 文件级检查

- 新版三个 JavaScript 文件及保留的 `prototype.js` 均通过 `node --check`。
- 用 Node VM 读取纯模板，对 1、3、100 epoch 的演示验证点数量、Best/Final 数值与曲线范围进行了检查。
- 新版入口只引用本地 CSS/JS；未加入外网字体、依赖或业务请求。
- 设计资产索引中，新版为 `needs-review`，旧稿为 `changes-requested`；没有标记 approved。
- 文档本地链接、HTML 本地资源及 Git 边界在交付前检查。仓库无首次提交，按完整文件核对，未使用不存在的 HEAD 作差异基准。

## 审阅与验收边界

本轮宿主自检：架构与目录边界未变；规格中的关键状态门禁通过演示交互检查；失败、取消、回传与清理路径分别观察。没有独立外部评审或跨模型验证，不将本自检称为正式三轴独立代码审查。

真实 PostgreSQL/MinIO 读写与重启持久化、模型目录上传、公开平台下载、优云目录/库存/报价、SSH/SFTP、训练后端、真实 Best 选择、vLLM 推理、云实例删除、页面关闭后的后端计时和 Worker 重启对账均待应用实施后验证。

ModelScope/Hugging Face 在本原型中只有表单与模拟导入；本轮重点点击了完整目录上传的恢复路径，未声称两个平台真实下载已通过。旧稿保留作对照，不作为新版验收范围。

应用实施票据保持未关闭。下一阶段读取顺序见[原型说明](../README.md)。