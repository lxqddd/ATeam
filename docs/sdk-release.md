# @ateam/client-sdk 发布前检查清单

SDK 目前以 `private: true` 形式留在 monorepo 中，不对外发布。本文记录把
`packages/client-sdk` 发布为公开 npm 包之前必须完成的检查；公开发布与否由维护者决定。

## 1. 全量验证

在仓库根目录运行，全部通过后再进入下一步：

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

## 2. OpenAPI 描述

- `pnpm --filter @ateam/headless test openapi` 通过：文档通过
  `@seriousme/openapi-schema-validator` 校验，且操作清单与 `api.ts` 中实现的路由完全一致。
- 启动服务后 `curl -s http://127.0.0.1:4096/openapi.json`（或 `/v1/openapi.json`）无需鉴权即可获取描述。
- 新增或删除路由时，必须同时更新 `apps/headless/src/server/openapi.ts` 与
  `apps/headless/src/server/openapi.test.ts` 中的 `EXPECTED_OPERATIONS`。

## 3. SDK 打包产物

```bash
pnpm --filter @ateam/client-sdk pack:check
```

`pack:check` 会先构建，再用 `npm pack --dry-run --json` 检查发布 tarball：

- 包含 `dist/index.js`（ESM）、`dist/index.cjs`（CJS）、`dist/index.d.ts`（类型）、
  `README.md`、`LICENSE` 与 `package.json`；
- `exports` 中每个条件指向的文件都存在于 tarball；
- `dist/index.d.ts` 不包含 `from '@ateam/shared'`（类型已由 tsup `dts.resolve` 内联），
  并声明了 `AteamClient` 与 `AteamApiError`。

该检查已加入 CI（`.github/workflows/ci.yml` 的 “Check SDK package” 步骤）。

## 4. 版本与元数据

- [ ] 更新 `packages/client-sdk/package.json` 的 `version`（遵循 semver；破坏性 API 变更提升主版本）。
- [ ] 确认 `name`、`description`、`license`、`author`、`repository`、`homepage`、`bugs`、
      `keywords`、`engines.node`、`files`、`publishConfig.access` 均为发布所需值。
- [ ] 若仓库迁移或改名，同步更新 `repository` / `homepage` / `bugs`。
- [ ] 更新 `packages/client-sdk/README.md`：安装方式、方法表、类型列表与新版本说明。
- [ ] 更新 `docs/features.md` §20（Server API 与 SDK）。
- [ ] 在仓库根 README 或变更日志中记录 SDK 版本。

## 5. 解除私有标记

- [ ] 公开发布前删除 `packages/client-sdk/package.json` 中的 `"private": true`
      （保留该字段时 `npm publish` 会直接拒绝）。
- [ ] 确认 `publishConfig.access`：公开包为 `"public"`；若改为私有 registry，按部署要求调整。
- [ ] 确认包名作用域 `@ateam` 在目标 registry 已注册且当前账号有发布权限。

## 6. 发布预演

在 `packages/client-sdk` 目录下：

```bash
npm publish --dry-run
```

核对输出的文件清单、大小与 `npm notice` 中的元数据；预演不会真正上传。

## 7. 发布

```bash
pnpm --filter @ateam/client-sdk build
cd packages/client-sdk && npm publish
```

发布后：

- [ ] 打 tag（如 `client-sdk-v0.2.0`）并创建 GitHub Release，附上变更说明。
- [ ] 从 registry 安装做冒烟测试：ESM `import { AteamClient }`、CJS `require('@ateam/client-sdk')`
      均可加载，`client.health()` 能访问本机服务，类型检查可解析 `SessionMeta` 等导出类型。
- [ ] 若发现严重问题，用 `npm deprecate` 标记问题版本并发布补丁版本。

## 兼容性约定

- 描述基于 OpenAPI 3.1.0；`servers` 同时声明 `/` 与 `/v1`。
- SDK 依赖全局 `fetch`，要求 Node.js 18+（或在同等的浏览器 / 运行时中使用）。
- 鉴权：服务端配置 token 时，所有路由（`/health`、`/openapi.json` 除外）需要
  `Authorization: Bearer <token>`；`/events` 额外支持 `?token=`。
