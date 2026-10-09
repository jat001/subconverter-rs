# 作为库与 WASM 使用

## Rust 库（crates.io）

crate 名为 [`subconverter-rs`](https://crates.io/crates/subconverter-rs)（库名 `libsubconverter`）：

```toml
[dependencies]
subconverter-rs = "0.3"
```

核心入口是 `SubconverterConfigBuilder` + `subconverter()`，与 HTTP API 走同一条管线：

```rust
use libsubconverter::interfaces::subconverter::{subconverter, SubconverterConfigBuilder};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut builder = SubconverterConfigBuilder::new();
    builder
        .target_from_str("clash")
        .add_url("ss://YWVzLTI1Ni1nY206dGVzdA==@example.com:8388#node")
        .add_emoji(true);

    let result = subconverter(builder.build()?).await?;
    println!("{}", result.content);
    Ok(())
}
```

builder 上可链式设置与 HTTP 参数一一对应的选项（`include_remarks`、`rename`、`udp`、`clash_flavor`、`update_interval` 等）。更底层的解析/生成也可以单独使用：

- `parser::explodes::explode(&link, &mut proxy)` — 单条分享链接 → `Proxy`
- `parser::explodes::explode_clash(&yaml, &mut nodes)` — Clash YAML → 节点列表
- `models::clash::ClashProxy::from_proxy(&proxy)` — 节点 → Clash 双向 schema
- `generator::exports::proxy_to_clash::proxy_to_clash(...)` 等各目标 emitter

> 说明：非 wasm 构建默认不含 HTTP 服务器（`web-api` 特性才有）；库本身可用在任意 tokio 程序中，HTTP 拉取订阅使用 awc（需在 `LocalSet` 中运行）。

## npm 包（WASM）

[`@jat/subconverter-wasm`](https://www.npmjs.com/package/@jat/subconverter-wasm) 是同一套 Rust 代码的 `wasm32` 构建（`--target nodejs`），面向 Node.js / Serverless：

```js
const wasm = require('@jat/subconverter-wasm');

// 初始化 KV 绑定与配置（Serverless 环境下文件读写走 KV 虚拟文件系统）
wasm.admin_init_kv_bindings_js();
await wasm.init_settings_wasm('/pref.yml');

// 与 /sub 相同的参数，以 JSON 传入
const resp = await wasm.sub_process_wasm(JSON.stringify({
    target: 'clash',
    url: 'https://example.com/sub',
    emoji: true,
}));
```

主要导出：

| 函数 | 说明 |
|------|------|
| `sub_process_wasm(query_json)` | 订阅转换（等价 `/sub`，返回 Promise） |
| `init_settings_wasm(pref_path)` | 加载服务端配置 |
| `admin_read_file` / `admin_write_file` / `list_directory` … | 虚拟文件系统管理（配置、规则文件） |
| `admin_load_github_directory(path)` | 从 GitHub 懒加载缺失的 base 配置/规则 |
| 短链接、规则更新等 | 见包的 `.d.ts` 类型定义 |

在 WASM 环境中"文件"读写通过 **KV 虚拟文件系统**（Netlify Blobs / Upstash Redis / Workers KV）完成，缺失的 `base/` 文件会自动从 GitHub 拉取。Workers 使用包中的 `@jat/subconverter-wasm/workers` 入口和 `KV` 命名空间绑定。

## 自部署 Netlify（Web GUI + Serverless API）

`www/` 目录是在线服务的完整实现（Vite React 单页应用 + Hono API + `@jat/subconverter-wasm`）：

1. Fork 本仓库，在 Netlify 新建站点指向 fork；base directory 留空，package directory 设为 `www`，不选择 Next.js Runtime。
2. 构建脚本从源码构建 WASM 和网页，`/api/*` 由 Netlify Function 运行共享 API；Netlify Blobs 自动提供持久存储。
3. 为 Functions 配置 `ADMIN_TOKEN` 后可使用配置编辑和短链管理。完整的平台设置见 [网页部署指南](https://github.com/jat001/subconverter-rs/blob/main/www/README.md)。

本地开发：

```bash
cd www
pnpm install
pnpm dev              # 使用 ../pkg 中已经构建的本地 WASM 包
pnpm rebuild:wasm:dev # 或者：本地重新构建 wasm 后再启动（需 wasm-pack、jq）
```

## 版本对应关系

`Cargo.toml` 的版本驱动 Rust 与 WASM 包，`www/package.json` 声明对应的 `@jat/subconverter-wasm` 版本。发布准备包括检查配置、验证本地构建和候选包、编写更新日志；推送发布标签或上传包必须等用户最后确认。不要把准备工作直接变成公开发布。
