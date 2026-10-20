# 原始文件与派生文件的映射

原站公开客户端：`https://pokebonk.com/`，采集版本 `0.7.8`，构建 `mvgfxz8a`。原始资源集合为 1714 个文件、40,175,997 字节；`asset-manifest.json` 保存 URL、引用依据、时间、大小、SHA256 及历史错误。

为避免重复存放整份素材，仓库采用以下布局：

| 来源清单路径 | 原始字节位置 |
|---|---|
| `index.html` | `original/index.html` |
| `assets/main-rEMKAGlg-mvgfxz8a.js` | `original/assets/main-rEMKAGlg-mvgfxz8a.js` |
| 其余 1712 项 | `asset-archive/` 分片资源包，展开后为 `offline_web/<清单路径>`，字节均未修改 |

`offline_web/index.html` 和主 JS 是派生版，另新增 `offline_web/offline-adapter.js`。根目录 `offline-adapter.js` 是同一适配器的开发与测试副本，两个副本必须一致。`build-record.json` 记录后端工厂的替换、原始/派生主 JS、派生入口和适配器哈希。

运行 `python scripts/prepare_client.py` 可先按分片 SHA256、ZIP 整体 SHA256 和逐成员白名单校验并展开素材；此步骤也会在服务启动时自动执行。每片独立 Base64 编码，按 manifest 顺序解码后拼接 ZIP，使用标准库，无需原站或第三方下载。

随后在仓库根运行 `python scripts/verify_sources.py`，可按映射重核全部原始哈希、两处派生改动、适配器副本及预期文件集合；后者只读检查，不联网、不执行游戏。

原始入口仅用于保留证据，不应直接运行。日常启动必须使用 `serve_local.py`，它只服务 `offline_web/` 并限制外连。

`runtime-summary.json` 仅保留真实本地运行的阶段、战斗指标与刷新结果，排除了完整浏览器存档、账号标识和 QA 存储。`original-verification.json` 保留原工作区处理前后对照摘要，其中目录名是历史运行标识，完整历史批次未重复上传。

通用归档器达到预算后的不完整状态、初版路径候选识别错误、拒绝覆盖、传输失败和补抓记录仍保留在来源清单。错误中的本机工作区绝对路径已改为相对标识，未删除错误原因。首次请求没有保存的响应头仍为 unknown。

已知三张图未取得：`items/fairy-feather.png`、`items/tm.png`、`ui/frames/type-dark.png`。来源清单描述已实际取得的原件，不表示原站全部资源或服务器已恢复。
