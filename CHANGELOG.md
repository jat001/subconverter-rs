# 更新日志

## 0.3.1（待发布）

此版本完善 0.3 系列的安装与发行方式，订阅转换功能、接口和存储格式沿用 0.3.0，无需迁移已有配置或短链。

- 修正发行文档中遗留的 Next.js 部署与候选版本说明，明确网页和 WASM 包各自的使用方式。
- 完善 Linux、macOS、Windows 原生发行包及 amd64/arm64 容器的构建检查，修正安装脚本对 macOS 和 32 位 Linux 架构的识别。
- npm 和 crates.io 使用 GitHub Trusted Publishing；发布流程支持先构建、验证认证和候选产物，再单独执行发布。

## 0.3.0 — 2026-10-10

这是 `jat001/subconverter-rs` 分支相对上游 0.2 系列的整体更新。重点是统一网页部署、补齐 Cloudflare Workers 支持，并改善订阅错误提示和后台访问控制。

### 网页与部署

- 网页改为 React 单页应用，Cloudflare Workers、Vercel 和 Netlify 使用同一套页面与 API。页面由静态托管提供，转换、文件管理和短链服务由后端处理。
- 新增 Cloudflare Workers 专用 WASM 构建，可通过 `wrangler.jsonc` 中的 `KV` 绑定保存配置和短链。
- 三个平台都从仓库源码构建转换引擎，不再依赖先发布一个 WASM 版本。平台构建缓存可复用 Rust 工具链、依赖和编译结果。
- 已知页面支持直接打开和刷新；无效地址返回真正的 HTTP 404，并显示中英文错误页面。

### 转换与存储

- 订阅下载失败时显示 HTTP 状态码和失败来源。空订阅、返回登录页或其他 HTML 页面、未识别到节点、节点被筛选规则全部移除，会给出对应原因。
- 修复 Upstash Redis 中二进制内容和 JSON 文本的读写问题。以前写入的旧格式值仍可读取。
- 修复异步存储调用中 WASM 内存变化导致的数据损坏，以及删除目录后留下内容或目录记录的问题。
- 缩短配置缓存的保留时间，让不同后端实例更及时地读取已修改的配置。

### 后台访问控制

- 网页后端的文件管理、规则更新和短链创建、修改、删除需要管理员令牌。未设置 `ADMIN_TOKEN` 时，这些管理接口不可用。
- 浏览器会提示输入管理员令牌；普通订阅转换和已有短链的公开跳转不要求管理员令牌。

### 从旧部署升级

- 网页已不再使用 Next.js。Vercel 应使用 Other 框架预设；Netlify 不应选择 Next.js Runtime。三平台的具体设置见 [网页部署指南](www/README.md)。
- 网页构建与 Node 后端使用 Node.js 24 LTS。前端项目包名改为 `subconverter-web`。
- 如果需要后台管理或保存、管理短链，请为对应部署环境配置 `ADMIN_TOKEN`。现有配置和存储命名空间继续使用，无需清空数据。
- 自定义 Jinja 模板使用新版模板引擎；直接输出布尔值仍保留小写 `true/false`。使用数值运算、`round` 或 `tojson` 等表达式的模板，应在升级前核对生成结果。

本版已发布 [npm 包](https://www.npmjs.com/package/@jat/subconverter-wasm/v/0.3.0) 与 [Rust crate](https://crates.io/crates/subconverter-rs/0.3.0)。原生程序和容器的完整发行流程在 0.3.1 中补齐。
