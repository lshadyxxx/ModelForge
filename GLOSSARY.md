# ModelForge

本表统一数据、训练、模型产物和推理试用的业务术语。

## Language

**DatasetVersion（数据集版本）**：
一份内容固定、可被训练任务明确引用的已校验数据集。

**Task（训练任务）**：
用户提交的一项目标明确的训练工作；同一任务可以有多次执行。

**Attempt（执行尝试）**：
一次具有独立输入快照、执行结果和产物来源的训练执行；重试是新的执行尝试。
_Avoid_: 把重试称为原执行继续成功

**BaseModel（基础模型、基座）**：
微调所依赖的原始模型；Adapter 不能脱离与其匹配的基础模型独立试用。

**ManagedModelVersion（托管模型版本）**：
由平台保管完整文件、内容固定且具有来源记录的模型版本。

**ExternalReadOnlyBaseModel（外部只读基座）**：
文件由外部平台保管、ModelForge 按已核对身份引用的基础模型；登记引用不表示平台持有其副本。
_Avoid_: 将公共目录路径等同于不可变版本

**Adapter（微调适配权重）**：
某次 LoRA 训练产生、与确定的基础模型版本关联的增量权重。

**Best Adapter**：
一次成功训练中，对应最低有效验证 Loss 的已保存 Adapter。

**Final Adapter**：
一次成功训练结束时的最终 Adapter；可能与 Best 指向同一结果。

**InferenceTrial（推理试用）**：
用户在平台内选定基础模型和 Adapter 版本后进行的多轮文本对话试用。
_Avoid_: 用公共模型回复代替本次 Adapter 的试用

## Relationships

- 一个 Task 包含一个或多个 Attempt；每个 Attempt 绑定明确的数据集、基础模型和配置。
- 基础模型版本可以由平台托管，或属于外部只读基座；两者的保管责任不同。
- 成功的 Attempt 保留 Best 和 Final Adapter；每个 Adapter 关联同一确定的基础模型版本。
- 推理试用绑定用户明确选择的 Adapter；停止当前生成和结束试用是不同操作。
