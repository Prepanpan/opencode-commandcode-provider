/**
 * ZDR（零数据保留）开关解析（契约：docs/dev/spec/disguise.md §0 D10 / §2 / §10）。
 *
 * 官方 CLI 1.84.0 解包定案：`isZdr: () => "1" === env().CMD_ZDR`，开启后
 * generate / 指纹 / lifecycle 三类请求统一携带 `x-cmd-zdr: 1`；无 ZDR 上游时
 * 网关返回 422 `cmd_zdr_no_providers`。本插件复刻该线上行为，开关通道按项目
 * 既有配置纪律排布：config > env > 默认关。
 *
 * - config（v1 `options.zdr` / v2 `settings.zdr`，经宿主透传为工厂 options 顶层
 *   键）严格 boolean：`true` 开、`false` 显式关闭并压过 env；
 * - env（`COMMANDCODE_ZDR`）严格字面量 `"1"`——与官方 CLI 判据逐字一致，
 *   `"true"` / `"0"` 等一律不算；插件使用自有前缀，不继承官方 `CMD_ZDR`（用户
 *   给本机真实 CLI 设的变量不应静默改变插件的计费行为）；
 * - 非法 config 值 warn + 按关闭处理，不回退 env、不阻断启动。
 *
 * 纯解析：config / env 以参数注入直测（测试不设置真实环境变量）。
 */

import type { DisguiseLogger } from "./logger.js"

/** 插件自有环境变量通道（用户配置面，非测试后门） */
export const ZDR_ENV_VAR = "COMMANDCODE_ZDR"

export interface ResolveZdrInput {
  /** config 通道原样值：v1 工厂 options.zdr / v2 settings 透传的顶层键，未解析 */
  readonly config?: unknown
  /** env 通道原值（process.env[ZDR_ENV_VAR]）；undefined = 未设置 */
  readonly env?: string | undefined
  readonly logger: DisguiseLogger
}

/** 解析 ZDR 开关；任何非法输入都落到「关」上，绝不抛错 */
export function resolveZdr(input: ResolveZdrInput): boolean {
  if (typeof input.config === "boolean") return input.config
  if (input.config !== undefined) {
    input.logger.warn(`zdr 值非法（${preview(input.config)}）：须为 boolean，已按关闭处理`)
    return false
  }
  // 严格 "1"：照抄官方 isZdr 判据，其余取值（含 "true"）静默视为关
  return input.env === "1"
}

/** 原值预览：warn 里注明被忽略的原始值（截断防日志爆炸） */
function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value)
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}
