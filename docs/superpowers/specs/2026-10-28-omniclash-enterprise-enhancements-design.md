# OmniClash 企业级体验进阶设计规范（CI/CD、零感领养与客户端画像）

日期：2026-10-28  
状态：设计阶段  
上游：`2026-10-27-omniclash-ac-ap-agent-design.md`（AC+AP 结构化 Agent）

---

## 1. 背景与目标

第二阶段已完成了轻量级 `omniclash-agent` 的实现与自愈安全闭环，将主路由控制子 AP 的延迟从 2.0s 压缩到 0.4s。为进一步实现商业级（UniFi 级别）用户体验与公开发布标准，本设计补齐以下三大子系统：

1. **工程自动化 (CI/CD)**：GitHub Actions 自动多包构建与 Releases 发布；
2. **零门槛分发与局域网自动发现 (Zero-Touch AP)**：主路由直接托管 Agent 安装包并提供一键命令，后台并发扫描局域网 DHCP/ARP 自动探测已安装 Agent 的子 AP；
3. **客户端设备画像与分流透视 (Client Profiling)**：点击 WiFi 矩阵槽位的连接数，下钻展示接入设备的 IP、MAC、主机名、信号强度 RSSI、物理协商速率及归属代理出口节点。

---

## 2. 模块详细设计

### 模块 A：GitHub Actions CI/CD 工作流 (`.github/workflows/release.yml`)

#### 触发机制
- `push` 带有 `v*` 格式的 Git Tag（如 `v0.0.1`、`v0.1.0`）；
- `workflow_dispatch`（支持手动一键构建）。

#### 构建流程
1. 环境：`ubuntu-latest`；
2. 依赖准备：Node.js 20+（用于 `po2lmo.js` 编译）、Python 3（用于 `gen_po.py` 语法校验）；
3. 执行开源标准构建：`./build.sh --release`（100% 纯净脱敏模式，严禁注入私有订阅）；
4. 计算三包哈希校验和：`sha256sum *.ipk > sha256sums.txt`；
5. 自动发布至 GitHub Releases，并附带双包说明与安装指令。

#### 交付产物
- `luci-app-omniclash_<version>_all.ipk`（主控套件）
- `luci-i18n-omniclash-zh-cn_<version>_all.ipk`（标准中文语言包）
- `omniclash-agent_<version>_all.ipk`（子 AP 代理端点）
- `sha256sums.txt`

---

### 模块 B：零门槛分发与局域网子 AP 自动发现 (Zero-Touch AP)

#### 1. 主路由静态托管 Agent 安装包
- **分发端点**：主路由 Web 根目录提供静态下载（`/www/omniclash-agent.ipk`，在主插件安装或更新时自动部署或软链）；
- **一键安装指令**：子 AP 侧无需任何电脑中转，登录终端执行单行命令即装：
  ```bash
  wget -qO /tmp/agent.ipk http://<主路由IP>/omniclash-agent.ipk && opkg install /tmp/agent.ipk
  ```
- **UI 集成**：子 AP 配置弹窗内展示带有快捷复制按钮的一键安装命令框。

#### 2. 局域网 AP 并发探测扫描 (`discover_ap`)
- **数据源**：主路由读取 `/tmp/dhcp.leases` 与 `/proc/net/arp`，提取当前主网段（如 `192.168.100.x`）所有活跃在线设备的 IP；
- **并发探测**：并发向候选 IP 发起 1 秒超时的轻量 HTTP 请求：
  `POST http://<ip>/cgi-bin/omniclash-agent`，载荷 `{"method":"ping","params":{}}`；
- **响应解析**：
  若返回 `{"ok":true, "hostname":"...", "board":"...", "version":"..."}`，即认定为 OmniClash 节点；
- **前端交互**：
  在子 AP 弹窗增加【🔍 自动扫描局域网 AP】按钮。扫描完成后直接以下拉卡片形式展示发现的设备，点击【填入此 AP】即可自动设定 IP；若该 AP 的 Token 与主路由记录匹配，连通性指示灯直接点亮 🟢。

---

### 模块 C：客户端设备画像与分流透视 (Client Profiling)

#### 1. 子 AP 采集层 (`get_clients`)
在 `omniclash-agent` 中扩展客户端详细信息采集：
- 通过 `iw dev <iface> station dump` 解析每个终端的明细：
  - `mac`: 客户端 MAC 地址；
  - `signal`: 接收信号强度（RSSI，单位 dBm）；
  - `tx_rate` / `rx_rate`: 实时协商速率（如 `574 Mbps, HE-MCS 11`）；
  - `inactive_ms`: 空闲毫秒数。

#### 2. 主控分析关联层 (`get_slot_clients`)
主控根据槽位 `sid` 查询该槽位对应的 AP 接口，并将采集到的 `mac` 关联至主路由系统的全局状态：
- 从 `/tmp/dhcp.leases` 读取并对齐：`ip` 与 `hostname`（如 `iPhone-16-Pro`、`MacBook-Air`）；
- 从当前合流规则及代理组状态对齐：当前槽位所绑定的出海代理节点（如 `WorkNet-US` -> `🇺🇲 美国节点`）；
- 最终产出结构化客户端画像数组。

#### 3. 前端交互大屏
- WiFi 矩阵中，在线客户端数字（例如 `2`）改为高亮可点击徽标；
- 点击后弹出居中模态卡片【槽位 #XX 在线客户端画像】：
  - 终端名称（主机名 / IP）
  - MAC 地址
  - 物理协商速率与信号强度（以进度条或信号柱直观显示，例如 `-45 dBm 极强`）
  - 归属分流出口

---

## 3. 安全与架构原则

1. **零断网底线**：自动扫描为只读探测（仅发 `ping` 请求），绝不执行任何写操作；
2. **轻量与低损耗**：
   - 自动扫描只探测主 LAN 网段，自动跳过 VLAN 子网（101~132），单次扫描严格限时（最多 2 秒）；
   - 客户端画像采取**按需拉取 (On-Demand RPC)**，不加重主表格定期轮询的负担；
3. **开源隐私纯净**：GitHub Actions 与主路由公开发行包 100% 保持脱敏，私有订阅依然仅限本地构建时动态覆盖。
