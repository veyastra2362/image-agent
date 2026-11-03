# AGENTS.md

本仓库采用 DeepSeek Harness 的决策笔记体系。技能 `write-notes-like-deepseek` **全局安装**在本机：

```
C:\Users\ASUS\.agents\skills\write-notes-like-deepseek\SKILL.md
```

（所有 agent 共享这一份；换机器时按技能名 `write-notes-like-deepseek` 定位其 SKILL.md，路径不必相同。）

## 重要改动必须留笔记

1. 非平凡改动（改了行为、架构、跨文件契约、流程与工具链、测试策略、落盘/网络/配置格式）前，遵循上述 SKILL.md 写或更新笔记；机械性小改（样式、格式化、打标、不改行为的补丁、常规 CRUD）直接提交，别为凑数立 Note。
2. 写之前先检索 `.agents/notes/` 里的同主题旧笔记：有归属就地更新；新想法先放 `proposed/`，落地随同代码改动转 `implemented/`；新方案彻底取代旧决策时，同批归档旧篇并标明被谁取代。
3. 被放弃的方案先写它最强的理由，再解释为什么不用。
4. 提交前跑 `npm run verify-notes`（tree + format + archived 三线串跑），红了先修再交。

## 目录约定

```
.agents/notes/{proposed,implemented,rejected,archived}/<class>/yyyy-mm-dd-主题.md
```

`class` 只有六个：`feature` / `bug-fix` / `simplification` / `architecture` / `process` / `testing`。
不建 `INDEX.md` —— 路径本身就是状态，避免多分支下的冲突源。

老方案被取代时：

```
npm run archive-note -- .agents/notes/implemented/<class>/<旧笔记>.md --superseded-by .agents/notes/implemented/<class>/<新笔记>.md
```

## 笔记载荷

- `implemented` 只写现在时事实，代码变了就就地改那几行，别开新篇；
- `## Consequences` 收益和代价都要写，只写"放弃了什么"的算没写到位；
- 跨笔记引用用相对 Markdown 链接，不要裸数字。
