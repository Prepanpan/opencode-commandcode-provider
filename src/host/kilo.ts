/**
 * Kilo CLI 宿主接线（Kilo CLI 7.8.x；宿主 API 世代：catalog 域）。
 *
 * Kilo 是 OpenCode 2 代码基的分支，但插件 ctx 的域集不同——探针（`~/.kilo/bin/kilo`
 * 二进制）结论：
 *
 * - **ctx 域集**：只有 `agent / aisdk / catalog / command / integration / plugin /
 *   reference / skill`，没有 OpenCode 2.0.4 引入的 `provider` 域（Kilo 的 `catalog`
 *   就是 2.0.0–2.0.3 世代的目录面）。故 `host/v2.ts` 在 Kilo 上会静默退出，本模块
 *   走 catalog 域接线。
 * - **provider 形状**：`ProviderV2.Info` = `{id, integrationID?, name, disabled?,
 *   api: {type:"aisdk", package, url?, settings?}, request}`——`package` 是 `api`
 *   的字段而非顶层字段（与 2.0.4 的 `editor.add` 形状不同）。
 * - **package 解析**：宿主对 `api.package` 走「`file://` 原样 import，否则按 npm 包名
 *   安装后取 entrypoint」，随后取模块第一个 `create*` 前缀导出作工厂。本插件的
 *   `createCommandCode` 正好落在这个判据上，`api.package` 直接写入口 URL
 *   （`ENTRY_URL`，已是 `file://` 形式，**不带** `aisdk:` 前缀——Kilo 不剥该前缀，
 *   写了会被当成 npm 包名去安装）。入口 URL 与插件加载路径同为
 *   `file:///…/dist/index.js`，宿主二次 import 命中同一模块实例（伪装状态进程内
 *   单例的前提）。
 * - **模型形状**：`ModelV2.Info` 的 `api` 为 `{id, type:"aisdk", package, …}`，
 *   `id` 是传给工厂 `languageModel()` 的模型 id（宿主取 `model.api.id`），故填
 *   wire id；variant 为 `{id, headers, body}`（**没有** OpenCode 2.0.4 的
 *   `settings` 键），档位经 `body` 合并进工厂 options——见 `provider/model.ts` 的
 *   `reasoningEffort` 工厂选项。
 * - **认证**：integration 域与 OpenCode 2 同形状，`registerIntegrationAuth` 直接复用。
 * - **刷新**：`catalog.reload()` 存在（与 2.0.4 的 `provider.reload()` 对位），后台
 *   拉取到新签名后重放本 transform。
 * - **32k 闸门**：v1 宿主对每次请求注入 `maxOutputTokens = min(limit.output, 32000)`，
 *   `host/v1.ts` 的 `chat.params` hook 为此而设。Kilo 无该闸门（只有
 *   `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX` 环境变量开启时才钳制），故本模块不注册
 *   hook，缺省 64e3 照官方 CLI 口径落地。
 *
 * 测试边界沿用 glue 纪律（testing.md §4）：无自动化测试，验证 = Kilo 真宿主。
 */

import { ENTRY_URL } from "../index.js"
import { registerIntegrationAuth, type IntegrationDomain } from "./integration.js"
import { toV2ModelFields } from "../models/mapping.js"
import type { V2ModelFields } from "../models/mapping.js"
import { PROVIDER_ID } from "../protocol/envelope.js"
import { ensureProviderRuntime, latestCascade } from "../provider/model.js"
import { PROVIDER_DISPLAY_NAME } from "./constants.js"

// ---------------------------------------------------------------------------
// 宿主 ctx 最小结构类型（零依赖承接；形状出处：Kilo CLI 7.8.1 内置插件与
// CatalogV2 服务的实际调用面）
// ---------------------------------------------------------------------------

/** `ProviderV2.Info` 中本插件写入的场：`request` 与 `disabled` 交宿主默认基线 */
interface KiloProviderDraft {
  id: string
  name: string
  integrationID?: string
  disabled?: boolean
  api: { type: "aisdk"; package: string; url?: string; settings: Record<string, unknown> }
  request: { headers: Record<string, string>; body: Record<string, unknown> }
}

/** `ModelV2.Info` 中本模块写入的场：`cost` 空数组 = 不写价格（model-pipeline.md §3.2） */
interface KiloModelDraft {
  id: string
  providerID: string
  name: string
  api: { id: string; type: "aisdk"; package: string; settings: Record<string, unknown> }
  capabilities: { tools: boolean; input: string[]; output: string[] }
  limit: { context: number; output: number }
  variants: Array<{ id: string; headers: Record<string, string>; body: Record<string, unknown> }>
  cost: unknown[]
  time: { released: number }
  status: "alpha" | "beta" | "deprecated" | "active"
  enabled: boolean
}

interface KiloCatalogDraft {
  provider: {
    update(providerID: string, update: (provider: KiloProviderDraft) => void): void
  }
  model: {
    update(providerID: string, modelID: string, update: (model: KiloModelDraft) => void): void
  }
}

interface KiloCatalogDomain {
  readonly transform: (callback: (draft: KiloCatalogDraft) => void) => Promise<unknown>
  readonly reload: () => Promise<void>
}

interface KiloPluginContext {
  readonly catalog?: KiloCatalogDomain
  readonly integration: IntegrationDomain
}

// ---------------------------------------------------------------------------
// 级联模型 → catalog model 的写入体
// ---------------------------------------------------------------------------

function applyModel(model: KiloModelDraft, resolved: V2ModelFields): void {
  model.name = resolved.name
  // `api.id` 是宿主传给工厂 languageModel() 的模型 id（Kilo 取 model.api.id），
  // 填 wire id；工厂侧 resolveWireId 对带前缀的 reference 也能正确剥前缀
  model.api = { id: resolved.modelID, type: "aisdk", package: ENTRY_URL, settings: {} }
  model.capabilities = {
    tools: resolved.capabilities.tools,
    input: [...resolved.capabilities.input],
    output: [...resolved.capabilities.output],
  }
  model.limit = { context: resolved.limit.context, output: resolved.limit.output }
  // 档位走 variant.body：Kilo 把选中 variant 的 body 合并进工厂 options，工厂经
  // `reasoningEffort` 工厂选项转成信封 `reasoning_effort`（OpenCode 2.0.4 走
  // variant.settings → providerOptions，Kilo 无该键）。严格透传：上游给什么档发什么
  model.variants = resolved.variants.map((variant) => ({
    id: variant.id,
    headers: {},
    body: { reasoningEffort: variant.settings.reasoningEffort },
  }))
  // 必填基线防御：字段归宿主 update-or-create 的 Model.Info 默认基线所有（缺位才补），
  // 已有值（含用户经 config 写入的 disabled）一律不覆盖
  model.cost ??= []
  model.status ??= "active"
  model.enabled ??= true
  model.time ??= { released: 0 }
}

// ---------------------------------------------------------------------------
// setup 接线
// ---------------------------------------------------------------------------

/**
 * Kilo 插件入口：自举 provider、模型与认证方法，并把共享运行时接上宿主目录。
 * 幂等——插件热重载重跑 setup 时 transform 重放为同一 provider/model（草稿自 fresh
 * 值重建）、运行时幂等构造、reload 回调重设到活 ctx。
 */
export async function setupKilo(context: unknown): Promise<void> {
  const ctx = context as KiloPluginContext
  const catalog = ctx.catalog

  // 宿主世代守卫：catalog 域 = Kilo 7.8.x 标识；OpenCode 2.0.4+ 的 setup 调用不带
  // catalog 域（v2 功能由 host/v2.ts 承担）
  if (catalog === undefined || typeof catalog.transform !== "function") return

  await catalog.transform((draft) => {
    draft.provider.update(PROVIDER_ID, (provider) => {
      provider.name = PROVIDER_DISPLAY_NAME
      provider.integrationID = PROVIDER_ID
      // package 写入口 URL 原样（file:// 形式）：Kilo 原样 import 后取第一个
      // create* 导出作工厂，命中同一模块实例；**不加 aisdk: 前缀**（Kilo 不剥它）
      provider.api = { type: "aisdk", package: ENTRY_URL, settings: {} }
    })
    // 模型注册：目录键与上游 modelID 同为 wire id（可含 `/`）。首播 = 包内快照
    // （启动零阻塞）；后台拉取签名变化触发 catalog.reload() 重放本回调，届时
    // latestCascade() 已是管线实时级联
    for (const resolved of latestCascade().models.map(toV2ModelFields)) {
      draft.model.update(PROVIDER_ID, resolved.id, (model) => {
        applyModel(model, resolved)
      })
    }
  })

  // 认证方法：与 OpenCode 2 同形状（integration 域同构）
  await registerIntegrationAuth(ctx.integration)

  // 共享运行时（模型管线 + 伪装状态单例）：注册全部完成后构造——变更回调只会晚于
  // 此刻触发，reload 不会空放
  ensureProviderRuntime({
    onModelDataChange: () => {
      catalog.reload().catch((error: unknown) => {
        console.warn(`[commandcode-go] catalog.reload 失败（${String(error)}），目录沿用上一份级联`)
      })
    },
  })
}