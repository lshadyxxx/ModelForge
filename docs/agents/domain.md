# Domain Docs

本项目采用 single-context：根目录 `GLOSSARY.md`，
架构决策记录位于 `docs/adr/`，均由消费技能按需创建。

## Before exploring, read these

- 先读 `README.md`、`docs/PROJECT_BRIEF.md`、`docs/ARCHITECTURE.md`、
  `docs/TECH_STACK.md` 和 `docs/IMPLEMENTATION_ROADMAP.md`。
- `GLOSSARY.md` 存在时，读取其中与任务相关的领域定义。
- `docs/adr/` 存在时，读取涉及当前工作范围的 ADR。

`GLOSSARY.md` 或 `docs/adr/` 尚不存在时直接继续，不为初始化流程预建
空文档，也不把缺失视为阻塞。`domain-modeling` 在术语或决策实际
明确时创建它们。此前沿用现有架构文档中的术语及定义。

## File structure examples

以下为按需创建后的路径示意，并非当前文件清单：

```text
ModelForge/
├── GLOSSARY.md
└── docs/
    └── adr/
        └── NNNN-decision-slug.md
```

## Use the glossary's vocabulary

问题标题、规格、设计、假设和测试名称使用领域文档已定义的术语。
尚未定义的概念先检查现有架构文档；确有缺口时记录给 `domain-modeling`，
不静默创造同义词或新的业务概念。

## Flag ADR conflicts

输出与现有 ADR 或已确定架构冲突时，明确指出冲突来源和原因，
先提出决策讨论，再修改实现或既有决策。
