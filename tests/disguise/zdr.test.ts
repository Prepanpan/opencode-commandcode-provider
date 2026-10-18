import { describe, expect, test } from "bun:test"
import { resolveZdr, ZDR_ENV_VAR } from "../../src/disguise/zdr.ts"
import { collectingLogger } from "./helpers.ts"

// ZDR 开关解析（docs/dev/spec/disguise.md §0 D10 / §2 / §10）：config 严格 boolean
// （显式 false 压过 env）、env 严格字面量 "1"（照抄官方 CLI isZdr 判据）、非法
// config 值 warn + 按关闭处理。纯函数直测，测试不设置真实环境变量（与 modelsUrls
// 同款纪律）。

describe("ZDR 开关解析（config > env > 默认关）", () => {
  test("config=true → 开（env 未设或为 1 都开）", () => {
    const logger = collectingLogger()
    expect(resolveZdr({ config: true, env: undefined, logger })).toBe(true)
    expect(resolveZdr({ config: true, env: "1", logger })).toBe(true)
    expect(logger.messages).toEqual([])
  })

  test("config=false → 显式关闭，压过 env=1", () => {
    const logger = collectingLogger()
    expect(resolveZdr({ config: false, env: "1", logger })).toBe(false)
    expect(logger.messages).toEqual([])
  })

  test("config 未写 + env=1 → 开；env 非 1（未设/0/true/空串）→ 关", () => {
    const logger = collectingLogger()
    expect(resolveZdr({ env: "1", logger })).toBe(true)
    for (const env of [undefined, "", "0", "true", "yes", " 1"]) {
      expect(resolveZdr({ env, logger })).toBe(false)
    }
    expect(logger.messages).toEqual([])
  })

  test("config 非法值（字符串/数字/null/对象）→ warn + 关，不回退 env", () => {
    for (const config of ["true", 1, null, {}, []]) {
      const logger = collectingLogger()
      expect(resolveZdr({ config, env: "1", logger })).toBe(false)
      expect(logger.messages.length).toBe(1)
      expect(logger.messages[0]!.startsWith("warn:")).toBe(true)
      expect(logger.messages[0]).toContain("zdr")
    }
  })

  test("env 变量名为官方之外的插件自有前缀（不继承 CMD_ZDR）", () => {
    expect(ZDR_ENV_VAR).toBe("COMMANDCODE_ZDR")
  })
})
