# 新增 Kilo CLI 宿主面：catalog 域接线，与 OpenCode 2 并列

> 状态：accepted（2026-10-05）。背景调查：`~/.kilo/bin/kilo` 二进制探针（Kilo CLI 7.8.1，2026-10-05 取证），无独立 research 文档——证据即宿主二进制内的插件加载器与 CatalogV2 服务实现。

## 背景与问题

用户环境只有 Kilo CLI（7.8.1），没有 OpenCode。Kilo 是 OpenCode 2 代码基的分支，插件入口同为 `default {id, setup}`，但**插件 ctx 的域集不同**：Kilo 只暴露 `agent / aisdk / catalog / command / integration / plugin / reference / skill`，没有 OpenCode 2.0.4 引入的 `provider` 域——`catalog` 就是 2.0.0–2.0.3 世代的目录面，而本插件 0.2.0 的 v2 接线（`src/host/v2.ts`）只认 `provider` 域，在 Kilo 上会静默退出、不注册任何 provider。

另一处不兼容在包解析：Kilo 对 provider 的 `package` 字段走「`file://` 原样import，否则按 npm 包名安装后取 entrypoint」，**不剥 `aisdk:` 前缀**。v2 接线的自指注册写的正是 `aisdk:<入口URL>`，照搬过去会被当成 npm 包名去安装而失败。

需要回答：Kilo 用户能否用上本插件，以及以何种形态接入。

## 决策

- **新增第三个接线** `src/host/kilo.ts`，走 Kilo 的 catalog 域：`catalog.transform` 内 `provider.update`（写 `api: {type:"aisdk", package: ENTRY_URL}`，**不带 `aisdk:` 前缀**）+ 逐模型 `model.update`（写 `api: {id: wireId, type:"aisdk", package: ENTRY_URL}`，因为 Kilo 取 `model.api.id` 作工厂入参）；后台刷新接 `catalog.reload()`。
- **入口分派** `src/host/dispatch.ts`：`ctx.provider.transform` 存在 → `setupV2`；`ctx.catalog.transform` 存在 → `setupKilo`；都不存在（v1 内嵌 runtime 的懒加载 setup）→ 两条接线各自安静退出。default 导出仍是 `{id, setup, server}` 三键，v1 宿主加载决策树不受影响。
- **认证复用** `src/host/integration.ts`：Kilo 的 integration 域与 OpenCode 2 同形状（同为 `Integration.KeyMethod {type:"key", label?}` 与 `EnvMethod {type:"env", names}`），抽出 `registerIntegrationAuth()` 供两条接线共用，避免凭证注册逻辑双写。
- **档位通道补一条** `CommandCodeFactoryOptions.reasoningEffort`：Kilo 的 v2 variant 形状是 `{id, headers, body}`（没有 OpenCode 2.0.4 的 `settings` 键），档位经 variant body 合并进工厂 options 后，在信封侧作 `providerOptions` 通道的兜底（优先级：调用级 `providerOptions` > 工厂选项）。共享核心改动照常三宿主生效，不算 v1 面新增。
- **不注册 `chat.params` hook**：Kilo 没有 v1 宿主的 32k 输出闸门（只有 `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX` 环境变量开启时才钳制），缺省 64e3 照官方 CLI 口径落地。
- **安装形态**：`~/.config/kilo/kilo.jsonc` 顶层 `plugin` 数组写 `"file:///…/dist/index.js"`。该路径同时是工厂的 `api.package`，宿主二次 import 命中同一模块实例（伪装状态进程内单例的前提）。

## 后果

- Kilo 用户装本插件后：`/connect` 出现 Command Code API Key，模型清单来自包内快照并在后台按签名刷新，无需手写 provider 配置。
- Kilo 宿主漂移（域集或 catalog 形状变化）由真宿主验证暴露——glue 按 `testing.md §4` 不进自动化测试。
- v1 / OpenCode 2 两条既有接线行为不变（450 项既有测试 + 1 项新增档位用例全绿）。