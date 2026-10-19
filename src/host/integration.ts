/**
 * integration 域接线（OpenCode 2 与 Kilo CLI 共用）。
 *
 * 两个宿主都在插件 ctx 上暴露 `integration.transform`，且 method 注册形状一致
 * （`{integrationID, method:{type:"key",label}}` 与 `{integrationID, method:{type:"env",names}}`）。
 * 语义：integration.update 对全新 provider 是 upsert——插件无需用户预置 provider 空壳；
 * key 方法带出 /connect 输入框，env 方法声明环境变量。凭证解析终点都是工厂 options 的
 * `apiKey`，优先级 credential > env 由宿主保证（OpenCode 2 与 Kilo 同一实现）。
 */

import { PROVIDER_ID } from "../protocol/envelope.js"
import { API_KEY_ENV_VAR, API_KEY_METHOD_LABEL, PROVIDER_DISPLAY_NAME } from "./constants.js"

/** integration 方法注册项：key 方法带 /connect 输入框标题，env 方法声明环境变量名 */
type IntegrationMethodRegistration = {
  readonly integrationID: string
  readonly method:
    | { readonly type: "key"; readonly label?: string }
    | { readonly type: "env"; readonly names: readonly string[] }
}

/** `integration.transform` 回调收到的草稿（宿主只暴露这两层，字段名按两宿主 SDK 类型收窄） */
export interface IntegrationDraft {
  readonly update: (id: string, update: (integration: { name: string }) => void) => void
  readonly method: {
    readonly update: (input: IntegrationMethodRegistration) => void
  }
}

/** ctx 上的 integration 域 */
export interface IntegrationDomain {
  readonly transform: (callback: (draft: IntegrationDraft) => void) => Promise<unknown>
}

/**
 * 注册 provider 的 integration 与两种认证方法。integrationID 与 providerID 同名
 * （`commandcode-go`）——宿主据此把凭证接到工厂 options 的 `apiKey`。
 */
export async function registerIntegrationAuth(integration: IntegrationDomain): Promise<void> {
  await integration.transform((draft) => {
    draft.update(PROVIDER_ID, (entry) => {
      entry.name = PROVIDER_DISPLAY_NAME
    })
    draft.method.update({
      integrationID: PROVIDER_ID,
      method: { type: "key", label: API_KEY_METHOD_LABEL },
    })
    draft.method.update({
      integrationID: PROVIDER_ID,
      method: { type: "env", names: [API_KEY_ENV_VAR] },
    })
  })
}