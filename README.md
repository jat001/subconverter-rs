# subconverter-rs

[English](README.en.md)

<div align="center">

<img src="www/public/logo.svg" alt="subconverter-rs 标志" width="150">

> 用 Rust 重写的代理订阅转换工具。

[![Rust](https://img.shields.io/badge/language-Rust-orange.svg)](https://www.rust-lang.org/)
[![Status](https://img.shields.io/badge/status-beta-blue.svg)](https://github.com/jat001/subconverter-rs)
[![GPL-3.0+ License](https://img.shields.io/badge/license-GPL--3.0%2B-blue.svg)](LICENSE)
[![Crates.io](https://img.shields.io/crates/v/subconverter-rs.svg)](https://crates.io/crates/subconverter-rs)
[![Telegram](https://img.shields.io/badge/Telegram-subconverter_rs-blue.svg)](https://t.me/subconverter_rs)
[![Netlify Status](https://api.netlify.com/api/v1/badges/35e931d3-b058-466e-88a5-e80247c5efd5/deploy-status)](https://app.netlify.com/sites/subconverter-rs/deploys)
[![GitHub stars](https://img.shields.io/github/stars/jat001/subconverter-rs?style=social)](https://github.com/jat001/subconverter-rs/stargazers)

</div>

subconverter-rs 以 C++ 版 subconverter 为基础，用于在不同代理客户端的订阅格式之间转换。Rust 实现改善了性能和稳定性，并兼容原版配置。

**当前为测试版。** 核心功能已实现，部分使用场景仍可能有问题。

版本变更和迁移说明见[中文更新日志](CHANGELOG.md)与[英文更新日志](CHANGELOG.en.md)。

将 WASM 网页一键部署到 Netlify。

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/jat001/subconverter-rs&base=www)

可通过[公开演示](https://subconverter-rs.netlify.app/)试用。提交订阅链接前请留意隐私风险。

## 目录

- [功能](#功能)
- [协议支持矩阵](#协议支持矩阵)
- [路线图](#路线图)
- [安装](#安装)
- [文档](#文档)
- [基本用法](#基本用法)
- [高级用法](#高级用法)
- [配置](#配置)
- [参与开发](#参与开发)
- [贡献者](#贡献者)
- [许可证](#许可证)

## 功能

- 使用 Rust 实现高性能订阅转换。
- 支持多种代理格式和协议。
- 支持筛选节点、重命名节点及添加表情符号。
- 支持自定义配置模板和规则集。
- 提供 HTTP 服务和 REST API。
- 兼容原版 subconverter 配置。

## 协议支持矩阵

下表列出各代理协议在不同目标格式中的支持情况。

| 协议 / 目标格式 | Clash | SingBox | Surge(2,3,4) | V2Ray | Quantumult | Quantumult X | Loon | Surfboard | Mellow | SIP002/8 | Mixed | TG-like |
|----------------------|:-----:|:-------:|:------------:|:-----:|:----------:|:------------:|:----:|:---------:|:------:|:--------:|:----------:|:-------:|
| AnyTLS               | ✅    | ❌      | ❌           | ❌    | ❌         | ❌           | ❌   | ❌        | ❌     | ❌       | ⬇️         | ⬇️      |
| VLESS                | ✅    | ✅      | ⚠️           | ✅    | ❌         | ⚠️           | ⚠️   | ❌        | ❌     | ❌       | ⬇️         | ⬇️      |
| Hysteria/2           | ✅    | ✅      | ⚠️           | ❌    | ⚠️         | ⚠️           | ⚠️   | ⚠️        | ⚠️     | ❌       | ⬇️         | ⬇️      |
| VMess                | ✅    | ✅      | ⚠️           | ✅    | ⚠️         | ⚠️           | ⚠️   | ⚠️        | ⚠️     | ❌       | ✅         | ⬇️      |
| Trojan               | ✅    | ✅      | ⚠️           | ❌    | ⚠️         | ⚠️           | ⚠️   | ⚠️        | ⚠️     | ❌       | ✅         | ⬇️      |
| SS                   | ✅    | ✅      | ⚠️           | ❌    | ⚠️         | ⚠️           | ⚠️   | ⚠️        | ⚠️     | ✅       | ✅         | ⬇️      |
| SSR                  | ✅    | ✅      | ⚠️           | ❌    | ⚠️         | ⚠️           | ⚠️   | ⚠️        | ⚠️     | ❌       | ✅         | ⬇️      |
| HTTP/SOCKS           | ✅    | ✅      | ⚠️           | ❌    | ⚠️         | ⚠️           | ⚠️   | ⚠️        | ⚠️     | ❌       | ⬇️         | ⬇️      |
| WireGuard            | ✅    | ✅      | ⚠️           | ⬇️    | ❌         | ⚠️           | ⚠️   | ⚠️        | ❌     | ❌       | ⬇️         | ⬇️      |
| Snell                | ❌    | ❌      | ⚠️           | ❌    | ❌         | ⚠️           | ⚠️   | ⚠️        | ❌     | ❌       | ⬇️         | ⬇️      |
| SSD                  | ⬇️    | ⬇️      | ⬇️           | ⬇️    | ⬇️         | ⬇️           | ⬇️   | ⬇️        | ⬇️     | ⬇️       | ❌         | ⬇️      |

**图例**

- ✅ 支持输入和输出
- ⚠️ 部分支持（未经测试）
- ⬇️ 仅支持输入
- ⬆️ 仅支持输出
- ❌ 不支持

**说明**

1. Shadowrocket 用户可使用 `ss`、`ssr`、`v2ray` 或 `mixed` 作为目标格式。
2. HTTP 或 SOCKS 链接没有名称时，可用 `&remarks=` 设置名称，用 `&group=` 设置分组。参数值需要 [URL 编码](https://www.urlencoder.org/)。
3. 目标为 `mixed` 时，所有受支持的节点会输出为 Base64 编码的普通订阅。

## 路线图

- **发布到 Gist**。自动将生成的配置上传至 GitHub Gist。
- **AnyTLS 支持**。增加对 AnyTLS 协议的支持。
- **可视化配置规则组**。提供配置规则组的图形界面。

## 安装

### 从 GitHub Releases 安装

使用安装脚本前，请确保已安装 `curl` 和 `jq`。

```bash
curl -sSL https://raw.githubusercontent.com/jat001/subconverter-rs/main/scripts/setup_and_run_subconverter.sh | bash
```

脚本会下载最新发行版，解压到 `subconverter` 目录并启动服务。也可在 [GitHub Releases](https://github.com/jat001/subconverter-rs/releases/latest) 手动下载。

### Docker

```bash
docker pull ghcr.io/jat001/subconverter-rs
docker run -d -p 25500:25500 ghcr.io/jat001/subconverter-rs
```

### 从 crates.io 安装

```bash
cargo install subconverter-rs --features web-api
```

### 从源码构建

```bash
git clone https://github.com/jat001/subconverter-rs.git
cd subconverter-rs
cargo build --release --features=web-api
```

构建产物位于 `target/release/subconverter`（Windows 为 `target/release/subconverter.exe`）。

## 文档

[项目 Wiki](https://github.com/jat001/subconverter-rs/wiki) 提供安装指南、完整的 `/sub` 参数参考、协议和目标格式支持列表、外部配置与节点过滤语法，以及 Rust 库和 WASM 集成说明。Wiki 源文件保存在本仓库的 [`wiki/`](wiki/) 目录。

## 基本用法

### API 地址

```http
http://127.0.0.1:25500/sub?target=%TARGET%&url=%URL%&config=%CONFIG%
```

### 参数

| 参数 | 必填 | 示例 | 说明 | 状态 |
| --- | :---: | --- | --- | :---: |
| `target` | 是 | `surge&ver=4` | 输出配置格式 | ✅ |
| `url` | 是 | `https%3A%2F%2Fwww.xxx.com` | 经过 URL 编码的订阅链接 | ✅ |
| `config` | 否 | `https%3A%2F%2Fwww.xxx.com` | 经过 URL 编码的外部配置地址 | ✅ |
| `flavor` | 否 | `premium` / `stash` | Clash 输出类型。默认使用支持完整功能的 mihomo。`premium` 和 `stash` 会去掉目标客户端无法读取的协议或字段，例如 Premium 的 VLESS/Hysteria2 和 Stash 的 uTLS 指纹。 | ✅ |

### 转换示例

<details>
<summary><b>转换单个订阅</b></summary>

```http
# 原始订阅链接 https://example.com/subscribe/ABCDE?surge=ss
# URL 编码后 https%3A%2F%2Fexample.com%2Fsubscribe%2FABCDE%3Fsurge%3Dss

http://127.0.0.1:25500/sub?target=clash&url=https%3A%2F%2Fexample.com%2Fsubscribe%2FABCDE%3Fsurge%3Dss
```
</details>

<details>
<summary><b>合并多个订阅</b></summary>

```http
# 原始订阅链接
# 1. https://example1.com/subscribe/ABCDE?clash=vmess
# 2. https://example2.com/subscribe/ABCDE?clash=vmess
# 用竖线连接 https://example1.com/subscribe/ABCDE?clash=vmess|https://example2.com/subscribe/ABCDE?clash=vmess
# URL 编码后 https%3A%2F%2Fexample1.com%2Fsubscribe%2FABCDE%3Fclash%3Dvmess%7Chttps%3A%2F%2Fexample2.com%2Fsubscribe%2FABCDE%3Fclash%3Dvmess

http://127.0.0.1:25500/sub?target=clash&url=https%3A%2F%2Fexample1.com%2Fsubscribe%2FABCDE%3Fclash%3Dvmess%7Chttps%3A%2F%2Fexample2.com%2Fsubscribe%2FABCDE%3Fclash%3Dvmess
```
</details>

<details>
<summary><b>转换单个节点</b></summary>

```http
# 原始节点链接 ss://YWVzLTEyOC1nY206dGVzdA==@192.168.100.1:8888#Example1
# URL 编码后 ss%3A%2F%2FYWVzLTEyOC1nY206dGVzdA%3D%3D%40192%2E168%2E100%2E1%3A8888%23Example1

http://127.0.0.1:25500/sub?target=clash&url=ss%3A%2F%2FYWVzLTEyOC1nY206dGVzdA%3D%3D%40192%2E168%2E100%2E1%3A8888%23Example1
```
</details>

### 将 Surge 快速转换为 Clash

```http
http://127.0.0.1:25500/surge2clash?link=SurgeSubscriptionLink
```

Surge 订阅链接无需 URL 编码。

## 高级用法

### 高级 API 参数

<details>
<summary><b>展开查看参数</b></summary>

| 参数 | 必填 | 示例 | 说明 | 状态 |
| --- | :---: | --- | --- | :---: |
| `emoji` | 否 | `true` | 在节点名称中启用表情符号 | ✅ |
| `add_emoji` | 否 | `true` | 在节点名前添加表情符号 | ✅ |
| `remove_emoji` | 否 | `true` | 移除节点名称中已有的表情符号 | ✅ |
| `append_type` | 否 | `true` | 在节点名称中附加代理类型（如 `[SS]`、`[SSR]`） | ✅ |
| `tfo` | 否 | `true` | 启用 TCP Fast Open | ✅ |
| `udp` | 否 | `true` | 启用 UDP | ✅ |
| `scv` | 否 | `true` | 跳过 TLS 节点的证书验证 | ✅ |
| `tls13` | 否 | `true` | 为节点启用 TLS 1.3 | ✅ |
| `sort` | 否 | `true` | 按名称排序节点 | ✅ |
| `include` | 否 | `(regex)` | 仅保留符合正则表达式的节点 | ✅ |
| `exclude` | 否 | `(regex)` | 排除符合正则表达式的节点 | ✅ |
| `filename` | 否 | `MyConfig` | 设置生成的配置文件名 | ✅ |
| `list` | 否 | `true` | 输出节点列表或 provider 格式 | ✅ |
| `insert` | 否 | `true` | 插入配置中 `insert_url` 指定的节点 | ✅ |
| `prepend` | 否 | `true` | 将插入的节点放在列表开头 | ✅ |

</details>

## 配置

配置文件的加载优先级依次为 `pref.toml`、`pref.yml`、`pref.ini`。

### 主要配置区段

<details>
<summary><b><code>[common]</code> · 全局节点过滤与基础配置</b></summary>

- `api_mode`：API 模式
- `api_access_token`：访问受限接口的令牌
- `default_url`：默认加载的订阅链接
- `enable_insert`：是否插入额外节点
- `insert_url`：提供插入节点的订阅链接
- `exclude_remarks`：排除符合正则表达式的节点
- `include_remarks`：仅保留符合正则表达式的节点
- `default_external_config`：默认外部配置文件
- `clash_rule_base`：Clash 配置模板
- `surge_rule_base`：Surge 配置模板

</details>

<details>
<summary><b><code>[userinfo]</code> · 从节点名称提取订阅用量信息</b></summary>

- `stream_rule`：提取流量信息的规则
- `time_rule`：提取时间信息的规则

</details>

<details>
<summary><b><code>[node_pref]</code> · 节点的 UDP、TFO、重命名与排序设置</b></summary>

- `udp_flag`：为节点启用 UDP
- `tcp_fast_open_flag`：为节点启用 TFO
- `skip_cert_verify_flag`：跳过 TLS 节点的证书验证
- `tls13_flag`：为节点加入 TLS 1.3 参数
- `sort_flag`：按名称排序节点
- `append_sub_userinfo`：是否附加流量信息
- `clash_use_new_field_name`：是否使用 Clash 的新字段名
- `clash_proxies_style`：Clash 配置文件样式
- `rename_node`：节点重命名规则

</details>

<details>
<summary><b>其他配置区段 · <code>[managed_config]</code>、<code>[emojis]</code>、<code>[ruleset]</code>、<code>[proxy_group]</code>、<code>[template]</code></b></summary>

这些区段分别用于托管配置、表情符号、自定义规则集、代理组和模板。详细说明见项目 Wiki。

</details>

### 外部配置

可将配置文件放在 GitHub Gist 或其他可访问的位置。将配置地址进行 URL 编码后，通过 API 的 `&config=` 参数传入。

### 本地生成配置

在本地生成配置时，先创建 `generate.ini`。

```ini
[test]
path=output.conf
target=surge
ver=4
url=ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNzd29yZA@www.example.com:1080#Example
```

随后运行以下命令。

```bash
subconverter -g
```

## 参与开发

欢迎提交 Pull Request。

1. 在 [Issues](https://github.com/jat001/subconverter-rs/issues) 中查找标记为 `good first issue` 或 `help wanted` 的任务。
2. 增加对新代理协议的支持。
3. 改善各格式解析器对异常输入的处理。
4. 补充测试，扩大覆盖范围。
5. 完善文档或添加使用示例。
6. 优化转换性能。

## 贡献者

<a href="https://github.com/jat001/subconverter-rs/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=jat001/subconverter-rs" />
</a>

## 许可证

本项目采用 GPL-3.0+ 许可证。详情见 [LICENSE](LICENSE)。
