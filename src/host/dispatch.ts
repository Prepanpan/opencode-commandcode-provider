/**
 * 宿主分派：按 ctx 域集判定宿主世代，把 `setup` 交给对应接线。
 *
 * - `ctx.provider.transform` 存在 → OpenCode 2.0.4+（provider/model 域）→ `setupV2`。
 * - `ctx.catalog.transform` 存在 → Kilo CLI 7.8.x（catalog 域）→ `setupKilo`。
 * - 两者都不存在（v1 宿主内嵌 runtime 的懒加载 setup 调用）→ 两个接线各自安静退出，
 *   v1 功能由 `server()` 承担（#37）。
 *
 * 三条接线都以「域缺失即安静退出」为守卫，故本模块只需选出该跑的那条。
 */

import { setupKilo } from "./kilo.js"
import { setupV2 } from "./v2.js"

/** v2 宿主 ctx 的判据域（形状见 host/v2.ts） */
interface ProviderDomainProbe {
  readonly provider?: { readonly transform?: unknown }
  readonly catalog?: { readonly transform?: unknown }
}

/** 插件入口分派器：宿主只读 default.setup 一个键，域集判别在此收口 */
export async function setup(context: unknown): Promise<void> {
  const ctx = context as ProviderDomainProbe
  if (typeof ctx.provider?.transform === "function") {
    await setupV2(context)
    return
  }
  if (typeof ctx.catalog?.transform === "function") {
    await setupKilo(context)
    return
  }
}