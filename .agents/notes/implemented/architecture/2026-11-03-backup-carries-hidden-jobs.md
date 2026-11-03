# Agent Note: 备份里带上界面偏好（已移除的任务）

Status: implemented

## Problem

任务列表支持右键「移除」——只从界面隐藏，作品文件和索引都不动。这个状态原先只存在渲染进程内存里：重启应用后所有被移除的任务又回来了。
把"移除"持久化之后又出现第二个问题：备份（ZIP 导出）只带 `settings/provider-settings.json` + `library/library.json` + 图片，换台机器导入备份后，移除状态丢失。

## Decision

隐藏列表跟着**作品库**一起走，用一份独立的偏好条目承载：

- 落盘键：`image-agent:hidden-jobs:v1`（`localStorage`，读写集中在 `src/renderer/lib/hidden-jobs.ts`）。
- 备份条目：`preferences/ui-state.json`，内容 `{ "version": 1, "hiddenJobIds": ["job-…"] }`。
- 导出时由渲染层把当前列表一起塞进 IPC payload（`appData.export({ ...selection, hiddenJobIds })`）；`data-ipc.ts` 校验元素是字符串、长度 ≤120、最多 5000 条。
- 导入时主进程读这个条目，随成功结果返回 `hiddenJobIds`；渲染层 `replaceHiddenJobs()` 写回本机，并派发 `image-agent:hidden-changed`，结果列表立刻按新状态过滤。
- 旧备份没有这个条目时，**不覆盖**本机现状（返回 `undefined`，面板不写回）。

同时明确：这个偏好 **never** 进增量同步的语义边界——目前导出是全量 ZIP，没有 lastSyncedAt/哈希，删除与冲突都靠"整体覆盖"。

## Alternatives considered

- **把隐藏列表存在主进程（`userData/hidden-jobs.json`）**：结构上更"正统"，备份由主进程直接读，不用过 IPC。代价是要新增一个 store + IPC 通道 + 启动时加载时序，而这份数据只是视图状态，不值得走一遍落盘层。
- **把隐藏做成"真删除"（连任务和资产一起删）**：语义最干净，也不存在备份问题。但用户明确要的是"只移除这次任务的显示"，删文件不可接受。
- **把 `hiddenJobs` 做成 `DataSelection` 的第三个复选框**：和其它两项平级最一致。但导出的复选是"配置 / 任务与图片"两档，移除状态依附于任务，多一个勾选框只会增加理解成本。
- **不做备份，靠用户手动清 localStorage**：实现成本为零，但换机器就丢，等于没做持久化。

## Consequences

- 收益：移除状态本机持久 + 可随备份迁移；旧备份仍能正常导入（缺条目时保留本机状态）。
- 收益：条目只在勾选「任务与图片」时写入，只备份配置的用户不会莫名其妙带上偏好。
- 代价 1：`preferences/ui-state.json` 与 `library/library.json` 生命周期不同（前者是视图状态），导入时若作品库没被勾选，偏好仍会被读取——这是有意为之（偏好与任务解耦），但读代码时要留意。
- 代价 2：JSON 里的 job id 是弱引用，导入到另一台机器时可能指向不存在的任务；目前不做清理，只是不生效。
- 代价 3：`localStorage` 与主进程数据混在两处，排查"某个任务为什么不见了"要同时想到这两层。

## Testing

- `src/test/image-data-manager.test.ts` 新增两条：
  - 导出带 `hiddenJobIds` → 清单里出现「界面偏好」条目 → 导入回传 `["job-1","job-2"]`；
  - 不传隐藏列表时条目仍写入空数组，导入返回 `[]`（兼容旧备份路径）。
- 渲染层：CDP 把某个真实 job id 写进 localStorage 并派发 `image-agent:hidden-changed`，任务列表 31 → 30，清掉后回到 31。
- `npm test` 141 条、`npm run smoke` 109 条。
