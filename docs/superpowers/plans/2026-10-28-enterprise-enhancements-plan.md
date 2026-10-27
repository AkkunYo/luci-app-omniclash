# OmniClash 企业级体验进阶实施计划

> **执行说明**：本计划涵盖 CI/CD 自动发布、子 AP 零门槛分发与局域网自动发现、以及客户端设备画像透视三大模块。全流程保持纯净个人作者身份提交，主干在线直接执行。

**目标**：实现全自动化 GitHub Releases 发布流水线、子 AP 极简 HTTP 托管分发与局域网并发探测、以及 WiFi 矩阵各槽位在线客户端画像与分流穿透透视。

**架构**：
- GitHub Actions：基于 Ubuntu Runner 执行 `./build.sh --release` 纯净脱敏构建并自动打包 Release 资产；
- 子 AP 分发与探测：主路由 Web 静态托管 `omniclash-agent.ipk`，引擎基于 `/tmp/dhcp.leases` 并发探针扫描局域网 Agent 节点；
- 客户端画像：Agent 端采集 `iw station dump` 物理层数据，主控端融合 DHCP 租约（主机名/IP）与分流策略出口，前端呈现交互画像模态大屏。

---

## 任务拆解与执行清单

### Task 1: GitHub Actions CI/CD 自动发布工作流
**目标文件**:
- 创建: `.github/workflows/release.yml`

- [ ] **Step 1.1**: 编写 GitHub Actions 工作流文件，配置 Tag `v*` 与 `workflow_dispatch` 触发。
- [ ] **Step 1.2**: 本地使用 `./build.sh --release` 校验脱敏构建流程与输出。
- [ ] **Step 1.3**: 提交并推送工作流文件至 GitHub。

---

### Task 2: 子 AP 极简 HTTP 托管分发 (Zero-Touch Distribution)
**目标文件**:
- 修改: `build.sh`（将 `omniclash-agent.ipk` 拷贝至主路由 `/www/omniclash-agent.ipk`）
- 修改: `htdocs/luci-static/resources/view/omniclash/matrix.js`（弹窗展示单行一键安装指令框）

- [ ] **Step 2.1**: 修改 `build.sh`，在打包主插件时将子 AP 代理包放置在 `/www/omniclash-agent.ipk`。
- [ ] **Step 2.2**: 在子 AP 配置弹窗增加可一键复制的单行终端安装命令：
  `wget -qO /tmp/agent.ipk http://<主路由IP>/omniclash-agent.ipk && opkg install /tmp/agent.ipk`。
- [ ] **Step 2.3**: 实机验证静态下载链接可访问性。

---

### Task 3: 局域网子 AP 自动并发探测 (`discover_ap`)
**目标文件**:
- 修改: `root/usr/bin/omniclash`（增加 `discover_ap` 动作）
- 修改: `root/usr/share/rpcd/ucode/luci.omniclash`（暴露 `discover_ap` RPC）
- 修改: `htdocs/luci-static/resources/view/omniclash/matrix.js`（增加【🔍 自动扫描】交互）

- [ ] **Step 3.1**: 在引擎中编写 `discover_ap`，读取 DHCP 租约并过滤主 LAN 候选 IP，并发向各 IP 发起 HTTP `ping` 探测。
- [ ] **Step 3.2**: 在 rpcd 模块中注册 `discover_ap`。
- [ ] **Step 3.3**: 前端在弹窗集成【🔍 自动扫描】，扫描到子 AP 后以下拉卡片展示，点击即可自动填入 IP。
- [ ] **Step 3.4**: 实机验证局域网自动发现鲁班子 AP (`192.168.100.2`)。

---

### Task 4: 槽位客户端设备画像透视 (Client Profiling)
**目标文件**:
- 修改: `agent/root/www/cgi-bin/omniclash-agent`（增加 `get_clients` 详细终端物理数据采集）
- 修改: `root/usr/bin/omniclash`（增加 `get_slot_clients` 融合 DHCP 租约与分流出口）
- 修改: `root/usr/share/rpcd/ucode/luci.omniclash`（暴露 `get_slot_clients` RPC）
- 修改: `htdocs/luci-static/resources/view/omniclash/matrix.js`（连接数改造为可点击徽标，弹窗展示终端画像）

- [ ] **Step 4.1**: 增强 Agent `get_clients` 方法，通过 `station dump` 提取客户端 `mac`、`signal` (dBm)、`rx_rate`、`tx_rate`、`inactive_ms`。
- [ ] **Step 4.2**: 在主控引擎增加 `get_slot_clients(sid)`，将物理 MAC 与 DHCP 租约的主机名/IP 以及当前槽位绑定的出海代理节点融合为完整结构。
- [ ] **Step 4.3**: 在 rpcd 模块注册 `get_slot_clients`。
- [ ] **Step 4.4**: 前端将在线客户端数量改为可点击交互徽标，点击打开模态卡片展示客户端画报。
- [ ] **Step 4.5**: 实机测试在线设备画像展示（如当前在线手机/电脑）。

---

### Task 5: 国际化同步、全套包编译与全链路实机验证
**目标文件**:
- 修改: `.superpowers/sdd/gen_po.py` 与 `po/` 目录全量词条
- 构建: `./build.sh`
- 验证: 主路由 J3160 + 子 AP 鲁班 实机联调

- [ ] **Step 5.1**: 提取新增界面的中英文词条，自动补齐 `.po` 并编译校验 LMO 二进制（确保 0 缺失）。
- [ ] **Step 5.2**: 执行本地构建并打包，部署到主路由与子 AP。
- [ ] **Step 5.3**: 全流程验证（静态下载、自动扫描、客户端画像、CI 语法）。
- [ ] **Step 5.4**: Git 提交并推送到 GitHub 远程仓库。
