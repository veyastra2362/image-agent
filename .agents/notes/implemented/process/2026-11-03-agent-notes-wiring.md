# Agent Note: 接入决策笔记体系（AGENTS.md + verify-notes）

Status: implemented

## Problem

仓库此前没有决策记录：135 次提交里"为什么这么定"只活在对话里。`460933e`（结果区分页）属于非平凡改动，但当时没留笔记，直到 23:05 才由 `c88232e` 事后补录一篇。缺的是"每个新会话一定会读到"的契约，而不是缺单篇笔记。

## Decision

在本仓库接入**全局安装**的 `write-notes-like-deepseek` 技能（`C:\Users\ASUS\.agents\skills\write-notes-like-deepseek\`）：

- 新增 `AGENTS.md`：四条规则 + 目录约定 + 笔记载荷，指向全局 SKILL.md；
- `package.json` 增加 `verify-notes`（tree + format + archived 三线串跑）与 `archive-note`；
- **不装项目级副本**：技能已全局安装，避免仓库里多一份 23 文件 / 约 120KB 的副本，也避免两份迟早漂移。

## Alternatives considered

- **项目级安装（官方默认 `npx skills add` 不带 `-g`）**：最强理由是技能随仓库提交，路径相对、换机器也不坏，别人 clone 下来就能用。但本机已全局装好且被 44 个 agent 目录共享，项目级会产出第二份副本；且实例化时代理不可用导致 `git clone` 失败，收益不抵多一份要维护的副本。
- **只写 AGENTS.md、不加 npm 脚本**：改动最小。但"提交前跑校验"没有固定入口，每个会话都得自己拼三条 npx 命令，实际会被跳过——这正是散文规矩失效的老路。
- **接 CI（复制 `templates/verify-notes.yml`）**：单机单人开发用不上，先把本地门禁立起来，等真要多人协作或远程 PR 再补。

## Consequences

- 收益：新会话启动即读到规则（`AGENTS.md` 是通用约定，DSH 与 Claude Code 都读），不必每次口头提醒；校验有单一入口，红了我能看到。
- 代价 1：`AGENTS.md` 与 npm 脚本里含本机绝对路径（`C:\Users\ASUS\...`），换机器或改用户名后失效，需要同步改两处；已在 `AGENTS.md` 注明换机器时按技能名重新定位。
- 代价 2：`verify-notes` 首次运行要用 `npx` 拉 `tsx`，无网络时失败；Node ≥ 23.6 可直接 `node <script>.ts` 绕过（本机验证过，Node 24 可跑）。
- 遗留：未接 CI；`proposed` / `rejected` / `archived` 三个生命周期尚无实际用例。

## Testing

- `npm run verify-notes` 退出码 0：tree 1 篇、format 1 篇、archived 0 篇 —— 即 `2026-11-03-result-fold-and-timeline-paging.md` 通过全部三项校验。
- `AGENTS.md` 里写的路径确实存在（`SKILL.md` 已核对）。
