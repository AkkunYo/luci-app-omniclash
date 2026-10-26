# OmniClash AC + AP 分布式控制设计（第二阶段）

日期：2026-10-27
状态：已确认，进入实施
上游：`2026-10-25-omniclash-traffic-routing-cards-design.md`（分流卡片流）

---

## 1. 背景与问题

当前插件用 **SSH（dropbear + sshpass）远程操作子 AP**。由此产生四类硬故障：

| 问题 | 现状 |
| :--- | :--- |
| 依赖密码 | 新场景首次必须知道子 AP 的 root 密码，且明文存 uci |
| 传输能力弱 | 每执行一段脚本就新建一次 SSH 连接，32 个槽位刷新要几秒 |
| 无结构化数据 | 靠 `echo "$sid\|$ssid\|..."` 文本拼接，字段含 `|` 或换行即错乱 |
| 安全面大 | 远程命令是拼接字符串，已证实存在注入（见 commit `d5491e3`） |

目标：把"主控 SSH 进子 AP 跑 shell"改成 **AC 与 AP 之间的结构化 RPC**，
类比企业 AC+AP：AP 上报自身状态、接收配置下发；AC 负责编排。

---

## 2. 传输选型

子 AP 是 ImmortalWrt 24.10，已具备：`uhttpd`（含 `cgi_prefix=/cgi-bin`）+ `ucode`。
因此 **在 uhttpd 的 CGI 目录挂一个 ucode 端点**，不引入任何新依赖、不新开端口：

```
AC (LuCI / ucode)  --HTTP POST /cgi-bin/omniclash-agent-->  uhttpd (AP)  -->  ucode 脚本
```

实机已验证：AP 上 `/www/cgi-bin/` 存在且 uhttpd 可执行 ucode CGI，
`stdin` 能读到 POST body，`getenv("REQUEST_METHOD")` 正常。

- 认证：请求头 `X-OmniClash-Token`，与 AP 上 `/etc/omniclash-agent/token` 比对
  （安装时随机生成的 32 字节十六进制）。
- 端口：沿用 AP 的 80，不新开端口，避免防火墙改动带来断网风险。
- 该方法不需要 AP 的 root 密码，因此**首次接入新场景不再依赖人工输入凭据**。

**为什么不选其他方案：**

| 方案 | 否决理由 |
| :--- | :--- |
| 继续 SSH | 结构化、性能、安全三项全部不达标 |
| ubus-over-HTTP (`/ubus`) | 已实测：匿名 session 只有 `session.login` 权限，登录必须提供 AP 的 root 密码——正是本次要消除的依赖 |
| 自建 TCP/JSON 守护 | 要新开端口、写独立 supervisor、和 procd 抢生命周期 |
| MQTT | 需要 broker，子 AP 上多一个常驻进程，内存吃紧 |
| 纯 CGI 无鉴权 | 局域网内任何人都能改 WiFi 配置，不可接受 |

---

## 3. 组件划分

### 3.1 新增包：`omniclash-agent`

装在**子 AP** 上。极小体积，只做三件事：

1. 在 `/www/cgi-bin/omniclash-agent` 暴露一个 JSON 端点
2. 读写本机 `wireless` uci，执行 `wifi reload`
3. 上报本机无线接口、客户端数、物理射频能力

**明确不做**：不编译 Mihomo 配置、不管订阅、不碰分流规则、不启代理。
子 AP 保持纯二层设备，不参与三层分流，避免拓扑耦合。

### 3.2 主插件侧改造

`/usr/bin/omniclash` 的 `wireless_exec()` / `ap_exec()` 改为**双通道**：

```
run_mode == "local"  -> 本机 shell_exec（完全不变）
run_mode == "ap"     -> agent HTTP RPC（首选）
                     -> SSH（回退，兼容未装 agent 的旧 AP）
```

通道选择在运行时探测并缓存，前端可见当前使用的通道。

---

## 4. agent 接口契约

端点：`POST http://<ap>/cgi-bin/omniclash-agent`
请求：`{"method":"<name>", "params":{...}}`，头 `X-OmniClash-Token: <token>`
响应：`{"ok":true, ...}` 或 `{"ok":false, "error":"<原因>"}`

| method | params | 响应 |
| :--- | :--- | :--- |
| `ping` | `{}` | `{ok, version, hostname, board, token_ok}` |
| `get_wifi` | `{}` | `{ok, interfaces:[{section,ssid,key,network,device,disabled,mode,encryption,clients}], limits:{'2g':n,'5g':n}, phys:[...]}` |
| `set_wifi` | `{section, ssid?, key?, network?, disabled?, encryption?}` | `{ok, changed:bool}` |
| `bulk_set_wifi` | `{items:[{section,...}]}` | `{ok, applied:n, failed:[{section,error}]}` |
| `provision_vlan` | `{items:[{section,ssid,key,vlan,device,network,disabled}]}` | `{ok, applied:n, failed:[...]}` |
| `reload_wifi` | `{dry_run?}` | `{ok}` |

设计约束：

- **幂等**：同一份入参重复调用不产生额外副作用（对比现值，无差异即不改）。
- **原子**：`bulk_set_*` 全部校验通过才 commit；任一项非法则整批拒绝。
- **不重启网络**：只用 `wifi reload`（热重载无线），绝不 `network reload`／`reboot`。
- **可回滚**：每次写前把 `uci export wireless` 备份到 `/etc/omniclash-agent/wireless.bak`。

---

## 5. 安全模型

1. **最小权限**：agent 是独立 CGI 脚本，只读写 `wireless` uci 与
   `/etc/omniclash-agent/*`。**不提供任何通用命令执行入口**，
   不做 `file.exec` 代理，不接受 shell 字符串。
2. **鉴权**：所有非 `ping` 请求必须带 `X-OmniClash-Token`，与 AP 上
   `/etc/omniclash-agent/token`（安装时随机 32 字节）恒定时间比对。
   `ping` 允许无 token，但只返回版本/主机名，不返回 SSID 与密码。
3. **只接受已知字段**：入参白名单，未知字段忽略；`section` 必须匹配
   `^[a-z0-9_]{1,32}$`，拒绝 `../`、点号、空值，防止写入其他 uci 段。
4. **字段值转义**：SSID/key 通过 `uci` 模块 API 写入（不经 shell），
   长度上限 SSID 32 字节、PSK 63 字节，超限拒绝而非截断。
5. **不削弱本机安全**：agent 不修改 AP 的 firewall zone，只沿用 lan 区
   `input ACCEPT`（本机已如此）；不新增监听端口。

---

## 6. 断电/断网安全（关键约束）

用户明确要求：**新插件安装不得造成不可恢复断网**。据此定死四条铁律：

1. **不碰网络接口**：agent 只写 `wireless` uci，绝不 `network`、`dhcp`、
   `firewall` 段，绝不 `network reload`。
2. **不做自动重启**：任何路径都不调用 `reboot`／`wifi down`。
3. **失败即不动**：所有写入先备份、后校验；校验失败直接返回错误，不 commit。
4. **改 WiFi 前自测**：`set_wifi` 若改动的是**当前 AC 所连的那个 SSID**，
   默认拒绝执行（`guard: true`），防止把自己踢下线。

主控侧同样约束：安装 agent 包只增加 `/usr/lib/luci/...` 与 rpcd 模块，
不触碰现有 `luci-app-omniclash` 的任何文件；两者可独立卸载。

---

## 7. 回退与兼容

- agent 未安装：`ping` 失败 → 自动回落 SSH，行为与当前版本完全一致。
- agent 已装但 token 不匹配：`ping` 失败 → 回落 SSH，并在 UI 提示。
- 强制通道：新增 uci `ap_transport = auto | agent | ssh`，默认 `auto`。

---

## 8. UI 变更

matrix 页「子 AP 配置」弹窗改为三段式：

1. **连接**：地址 / 端口 / 用户名 / 密码（保留）+ 「安装 Agent」引导
2. **通道状态**：实时显示 `Agent (v0.1.0)` 或 `SSH (兼容模式)` + 一键诊断
3. **同步**：32 槽位批量下发走 `bulk_set_wifi`，失败项逐条列出

---

## 9. 验收标准

1. 装 agent 后，32 槽位刷新耗时 < 1.5s（现状 SSH 约 4–6s）
2. 拔掉 AC-AP 之间网线再插回，agent 通道自动恢复，无需人工干预
3. 未装 agent 的子 AP 上，所有功能与改造前**逐字节一致**
4. 安装/卸载 agent 包全程不断网（AP 上已连客户端不掉线）
5. 恶意入参（`section=../../etc/passwd`、超长 SSID）被拒绝且不落盘
