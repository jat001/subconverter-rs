# 更新日志 / Changelog

## 0.3.2

### 中文

此版本更新转换引擎、网页和 WASM 的依赖。已有订阅链接、配置和短链可以继续使用，无需迁移。

- 更新原生 HTTP、TLS 和模板引擎依赖，以及网页的 React、Vite、Hono 和 WASM 存储依赖。
- 自托管网页的构建环境升级到 Node.js 26 LTS 和 pnpm 12。Vercel 和 Netlify 的构建脚本会在需要时准备 pnpm 12。
- Cloudflare Workers 的兼容日期更新至 `2026-11-18`，启用新的模块注册表。
- 平台构建遇到损坏的 Rust 工具链缓存时会自动重装工具链。

### English

This release updates the conversion engine, web app, and WASM dependencies. Existing subscription URLs, configurations, and short URLs require no migration.

- Updated the native HTTP, TLS, and template engine dependencies, along with React, Vite, Hono, and the WASM storage libraries.
- Building the web app from source now uses Node.js 26 LTS and pnpm 12. The Vercel and Netlify build scripts install pnpm 12 when needed.
- Updated the Cloudflare Workers compatibility date to `2026-11-18`, which enables the new module registry.
- Platform builds reinstall Rust when the cached compiler cannot run.

## 0.3.1

### 中文

此版本完善 0.3 系列的安装与发行方式，订阅转换功能、接口和存储格式沿用 0.3.0，无需迁移已有配置或短链。

- 修正发行文档中遗留的 Next.js 部署说明，明确网页和 WASM 包各自的使用方式。
- 完善 Linux、macOS、Windows 原生发行包及 amd64/arm64 容器的构建检查，修正安装脚本对 macOS 和 32 位 Linux 架构的识别。
- npm 和 crates.io 使用 GitHub Trusted Publishing，通过工作流验证身份后发布；不再需要长期发布 token。

### English

This release improves installation and distribution for the 0.3 series. Subscription conversion, interfaces, and storage formats carry over from 0.3.0. Existing configurations and short URLs require no migration.

- Corrected outdated Next.js deployment instructions and clarified how to use the web app and the WASM package.
- Expanded build checks for native Linux, macOS, and Windows archives and amd64/arm64 container images. Fixed architecture detection for macOS and 32-bit Linux in the installer.
- npm and crates.io now authenticate through GitHub Trusted Publishing. The release workflow uses short-lived credentials issued for each publish.

## 0.3.0

### 中文

这是 `jat001/subconverter-rs` 分支相对上游 0.2 系列的整体更新。重点是统一网页部署、补齐 Cloudflare Workers 支持，并改善订阅错误提示和后台访问控制。

#### 网页与部署

- 网页改为 React 单页应用，Cloudflare Workers、Vercel 和 Netlify 使用同一套页面与 API。页面由静态托管提供，转换、文件管理和短链服务由后端处理。
- 新增 Cloudflare Workers 专用 WASM 构建，可通过 `wrangler.jsonc` 中的 `KV` 绑定保存配置和短链。
- 三个平台都从仓库源码构建转换引擎，不再依赖先发布一个 WASM 版本。平台构建缓存可复用 Rust 工具链、依赖和编译结果。
- 已知页面支持直接打开和刷新；无效地址返回真正的 HTTP 404，并显示中英文错误页面。

#### 转换与存储

- 订阅下载失败时显示 HTTP 状态码和失败来源。空订阅、返回登录页或其他 HTML 页面、未识别到节点、节点被筛选规则全部移除，会给出对应原因。
- 修复 Upstash Redis 中二进制内容和 JSON 文本的读写问题。以前写入的旧格式值仍可读取。
- 修复异步存储调用中 WASM 内存变化导致的数据损坏，以及删除目录后留下内容或目录记录的问题。
- 缩短配置缓存的保留时间，让不同后端实例更及时地读取已修改的配置。

#### 后台访问控制

- 网页后端的文件管理、规则更新和短链创建、修改、删除需要管理员令牌。未设置 `ADMIN_TOKEN` 时，这些管理接口不可用。
- 浏览器会提示输入管理员令牌；普通订阅转换和已有短链的公开跳转不要求管理员令牌。

#### 从旧部署升级

- 网页已不再使用 Next.js。Vercel 应使用 Other 框架预设；Netlify 不应选择 Next.js Runtime。三平台的具体设置见 [网页部署指南](www/README.md)。
- 网页构建与 Node 后端使用 Node.js 24 LTS。前端项目包名改为 `subconverter-web`。
- 如果需要后台管理或保存、管理短链，请为对应部署环境配置 `ADMIN_TOKEN`。现有配置和存储命名空间继续使用，无需清空数据。
- 自定义 Jinja 模板使用新版模板引擎；直接输出布尔值仍保留小写 `true/false`。使用数值运算、`round` 或 `tojson` 等表达式的模板，应在升级前核对生成结果。

### English

This release updates `jat001/subconverter-rs` from the upstream 0.2 series. It unifies web deployment, adds full Cloudflare Workers support, and improves subscription error messages and admin access controls.

#### Web app and deployment

- The web app is a React single-page application. Cloudflare Workers, Vercel, and Netlify serve the same pages and API. Static hosting serves the pages, and the backend handles conversion, file management, and short URLs.
- Added a WASM build for Cloudflare Workers. Use the `KV` binding in `wrangler.jsonc` to store configurations and short URLs.
- All three platforms build the conversion engine from source. Their build caches can reuse the Rust toolchain, dependencies, and compiled artifacts.
- Known pages support direct navigation and refresh. Unknown paths return HTTP 404 with an error page available in Chinese and English.

#### Conversion and storage

- Subscription download errors show the HTTP status and the failing source. Messages also distinguish empty subscriptions, login or other HTML pages, unrecognized nodes, and cases where filters remove all nodes.
- Fixed binary and JSON-text reads and writes in Upstash Redis. Values written in the previous format remain readable.
- Fixed data corruption when WASM memory grows during asynchronous storage calls. Directory deletion now clears both file contents and directory records.
- Shortened configuration cache lifetimes so backend instances pick up updates sooner.

#### Admin access

- File management, rule updates, and creating, editing, or deleting short URLs require an admin token. These endpoints are disabled when `ADMIN_TOKEN` is unset.
- The browser prompts for the admin token when needed. Subscription conversion and redirects for existing public short URLs remain available without it.

#### Upgrading an existing deployment

- The web app now uses Vite. Select the Other framework preset on Vercel and leave the framework runtime unset on Netlify. See the [web deployment guide](www/README.md) for all three platforms.
- Web builds and the Node backend use Node.js 24 LTS. The web app package is now named `subconverter-web`.
- Set `ADMIN_TOKEN` in each deployment environment where you need to manage files or short URLs. Existing configurations and storage namespaces can be reused.
- Custom Jinja templates use an updated engine. Rendering a boolean directly still produces lowercase `true` or `false`. Check templates that use arithmetic, `round`, or `tojson` before upgrading.
