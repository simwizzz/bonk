# PokéBonk 0.7.8 本地适配器契约

决策摘要：适配器让保留的客户端通过本地访客进入初始选角、联盟、实验室和战斗，并把本地进度保存在当前浏览器。它不重建官方后端，不使用官方会话，不访问公网 API。客户端公开的实验室、物品、任务规则通过闭包绑定复用。服务端独有的通用战斗星尘、赛季排行、奖章判定与账号社交没有被伪造为已还原。

## 接入

文件 `offline-adapter.js` 为 ES module，导出 `createReaLocalBackend(options)`。仅在派生客户端中增加 import，并替换 `SE()` 返回值；原始静态文件应保持不变。

```js
import { createReaLocalBackend } from '../offline-adapter.js';

function SE() {
  return createReaLocalBackend({
    rules: {
      createProfile: Iy,
      normalizeProfile: Ly,
      refreshTasks: Xy,
      buyLab: Gy,
      buyItem: Ky,
      archiveItem: (p, key, off) => qy(p, key, off, key => Te.has(key)),
      claimQuest: Jy,
      claimTask: eb,
      rerollTask: tb,
      score: yt,
      season: y,
      starters: Ny,
      leagueHas: id => m.has(id),
      leagueReady: Wy,
      biomes: ne,
      biomeEnabled: C,
      task: ce,
      counterCaps: Me,
      shinyRewards: ae,
    },
    dex: () => rb,
  });
}
```

以上压缩符号仅适用于所保留的 `main-rEMKAGlg-mvgfxz8a.js`、`news-CJ84W1Ky-mvgfxz8a.js`。不能把绑定迁移到别的版本而不重新检查。工厂不自行 import 或执行这些原始文件。未传 options 时，可从 `globalThis.REA_POKEBONK_RULES` 取得规则；未绑定必要规则会明确失败。

`options.storage`、`now`、`random` 仅用于替换存储、时间与随机源，方便自建样例验证；生产默认使用 localStorage、Date.now 和 crypto.getRandomValues。默认存储键为 `rea.pokebonk.0.7.8.state.v1`。自定义键也必须以 `rea.` 开头。不会读取、迁移、清除或写入 `pb.*`。

## 已观察到的调用契约

| 接口 | 适配行为 |
|---|---|
| `kind` / `clockSkew` | `local` / `0`；触发客户端现有本地分支 |
| `status()` | 维护关闭、访客可进入；赛季标为 REA 本地且 `live:false` |
| `restore()` / `guest()` / `guestSave()` / `logout()` | 本地访客会话；无 token；退出保留存档，重新进入恢复同一访客 |
| `loadProfile(account)` | 返回独立副本、更新客户端任务周期、按既有地图链开放区域；新实例可结算已保存的未完成快照 |
| `savePrefs(account, profile)` | 仅保存原 xE 的设置字段白名单，不从整个前端 profile 覆盖货币或进度 |
| `chooseStarter(account, id)` | Ny 列表首次选一只加入联盟；相同选择幂等，不能再次选择另一只 |
| `buyLab` / `buyItem` / `archiveItem` | 在独立持久化 profile 上调用 Gy / Ky / qy；不会重复使用前端已乐观扣款的对象 |
| `claimQuest` / `claimTask` / `rerollTask` | 调用 Jy / eb / tb，保存原规则规定的奖励与次数 |
| `startRun(account, config)` | 检查联盟成员、地图、难度与增益库存；消耗道具；返回独立本地票据、随机 seed、`ranked:false`、`local:true` |
| `checkpoint(account,ticket,cp)` | 保存本地检查点，未上传，不作云端可信认证 |
| `keepLive(account,ticket,result)` | 保存最近可结算快照；同一实例进行中的 resync 不会误结算它 |
| `finishRun(account,ticket,result)` | 检查配置匹配、结算已观测战斗/捕获/研究/任务进度，返回 `{profile,record,stardust,tasks,ranked:false,local:true,reason}`；reason 明确本地存档边界，避免原 UI 错报“未通过服务器校验” |
| `hasPending` / `retryNow` | 查询或结算本地快照、重试本会话内写入失败的完整结束结果；仍活跃的快照不会被谎报成已结算 |
| `records` / `endlessRecords` | 返回空的赛季记录集合；个人本地纪录在 profile 的 runs/kills/times/endless 中 |
| `news()` | 单条明确标注还原边界的本地说明，未伪造官方新闻 |
| `exportLocalSave()` | 返回完整本地存档副本，便于单独保存备份 |

票据中的 `offline:false` 是客户端控制字段：它避免进入原有“服务器离线、此局不保存进度”的分支。本适配器实际保存本地进度，并同时标注 `local:true`、`ranked:false`；它没有连接云端。`onSaved` 等回调属性保留供调用方设置，但本地快照恢复不会触发客户端原本声称“已存入账号”的云端提示卡。

## 本地结算范围与明确限制

- 依据 `V_.result` 和 `ib.report` 的实际字段保存战斗记录。`Me(result)` 仅给出进度计数器上限，不是完整结算器；适配器只接受该列表中的增量，并限制到对应上限。
- 保存击败数、伤害、时间、等级、守卫、阿尔法、反应、已使用种类、地图相关计数、研究、见过的角色、形态和捕获。研究上限复用 rb；联盟捕获须同时满足既有成员定义与 Wy 挑战条件。
- 初始选角与加入联盟的字段更新遵循客户端对应流程，但服务端初始选角实现没有随静态客户端公开，这部分明确属于本地实现。
- 普通模式胜利把当前地图完成难度更新到 `tier + 1`，随后按 ib 的地图链打开下一个区域；保留个人击败纪录和胜利时间。无尽模式记录时间与击败数。上述持久化合并由本地实现，不能称为服务端代码的逐字恢复。
- 每日/每周任务依据客户端任务的 metric 累计；`time`、`level`、`stage`、`runKills` 按单局最大值，其余按可观测增量累计。领取和重抽继续使用客户端函数。
- 闪光捕获奖励复用客户端 ae 的 first/repeat 值；任务奖励继续使用客户端规则。静态文件中没有通用战斗星尘结算公式，因此通用战斗星尘为 **0**，未另编造一套数值。实验室可使用已知任务和闪光捕获所得星尘。
- 不授予官方时间奖章、赛季奖励、排行位置或 Mewtwo 专项证明。结果没有可用于可靠证明该专项击败的独立事件，不能仅凭持续时间猜测。
- 同一票据结算幂等；重试返回当前存档与既有收据，不重复加奖励。重新加载后可关闭并结算最近快照，不能恢复战斗位置和继续同一局。
- 如果结束时浏览器存储写入失败，本会话内保留完整结果供重试；重试成功前不声称已持久化。关闭页面会丢失这份内存结果，重新打开时只能使用之前已成功保存的快照；没有快照则无法恢复该局。
- 当前以单个游戏页为使用范围。未实现原 HTTP 后端的跨标签页 Web Lock 协调；另一个实例读取仍在运行的快照可能将其当作恢复记录关闭。不要同时开启多个本地游戏页。
- 本地存储容量不足或存档损坏会明确报错，并保留旧数据，不静默改为不持久化运行。

注册、登录、升级账号、账号改名/重置/删除、所有排行榜/赛季奖励、玩家资料/云端构筑、反馈提交、邮件、好友和公会接口统一拒绝，并提示“REA 离线还原版……未启用；进度仅保存在此浏览器”。不会返回虚构的云端成功结果。这里的“联盟”是游戏角色收集系统；公会和好友属于未实现的社交功能。

## 原规则引用

以下是原始 UTF-8 JS 文本中的字符偏移，便于定位，不代表当前服务器实现：

| 来源 | 字符偏移/符号 | 证据 |
|---|---|---|
| main | 1087889 `Iy`、1088358 `Ly` | 初始 profile 和默认设置、归一化 |
| main | `Gy/Ky/qy/Jy/Xy/eb/tb`，位于 Ly 后 | 实验室、物品、档案、成就和周期任务变更 |
| main | 1092890 `ib` | profile 状态管理、开始/结束/快照/增量报告调用 |
| main | 1097833 `ib.joinLeague` | 联盟、unlocked、captured、captures 字段 |
| main | 1098886 `biomeUnlockedByChain` | 前一地图完成一次才开放下一地图 |
| main | 1005194 `V_.result` | 实际战斗结算数据形状 |
| main | 1456338 `xE`、1469264 `SE` | HTTP 接口与目标工厂 |
| main | 1474730 `AE` | boot/status/restore/loadProfile/openRun 调用 |
| news | 56414 `_t`，在 main 中名为 `Me` | 可报告的计数器上限 |
| news | `Le={first:120,repeat:50}`，在 main 中名为 `ae` | 已知闪光捕获奖励 |
| main | 闪光捕获 `let a=i?ae.first:ae.repeat` | 首次/重复闪光捕获时使用 ae，直接更新前端 stardust |

## 验证

命令：`node tests/test_pokebonk_adapter.mjs`。

测试完全使用自建 profile、角色、任务、奖励和规则函数，未 import/执行原始游戏。覆盖访客与退出、单次初始选角、存储命名空间、偏好保存不覆盖进度、地图与道具限制、配置不一致拒绝、捕获/研究/任务合并、已知奖励、幂等结算、快照恢复、实验室扣款、在线功能明确拒绝、损坏存档保留、容量失败后的完整结果重试（包括没有旧快照的情形），以及仍活跃快照不误报已保存。结果：通过。

这属于适配器合约样例验证，不等同于真实客户端运行或原生视觉验收。
