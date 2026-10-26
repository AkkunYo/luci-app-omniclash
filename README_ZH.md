# luci-app-omniclash

[English](README.md) | **简体中文**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![OpenWrt Version](https://img.shields.io/badge/OpenWrt-23.05%20%7C%2024.10%20%7C%20iStoreOS-brightgreen.svg)](https://openwrt.org/)
[![Architecture](https://img.shields.io/badge/Arch-All%20(x86_64%20%7C%20ARM%20%7C%20MIPS)-orange.svg)](https://github.com/AkkunYo/luci-app-omniclash)
[![Core](https://img.shields.io/badge/Core-Mihomo%20Meta%20(TUN%20Mode)-red.svg)](https://github.com/MetaCubeX/mihomo)

**OmniClash** 是专为 OpenWrt / iStoreOS 打造的企业级旗舰全能网络控制套件。集成了 **Mihomo (Meta) 独立系统级守护进程**、**32 槽位无线 AP 硬件矩阵双向联动** 与 **纯本地数据驱动全动态合流分流编译器**。

遵循 OpenWrt 官方标准生态规范，主体插件 `luci-app-omniclash` 默认英文，中文支持通过独立的官方标准语言包 `luci-i18n-omniclash-zh-cn` 提供。

---

## 🌟 核心特性与架构亮点

### 1. 📶 32 满额无线 AP 矩阵管理 (跨设备双向同步)
* **硬件级满额常驻**：预设 5G Wi-Fi 6（16 槽位，`#01~#16`）+ 2.4G（16 槽位，`#17~#32`）满额物理槽位。
* **物理 VLAN 严格隔离**：全量 32 组独立 VLAN 子网（`VLAN 101` ~ `132`）与独立 DHCP 池全网常驻，拒绝频繁重装网络。
* **真实芯片双向同步**：自动实时探测 AP 硬件网卡真实活跃 BSSID、在线客户端数与物理广播状态。
* **毫秒级软开关**：一键开启/关闭空中 SSID 广播，无需等待网络重载，配置永不丢失。
* **⚡ 一键补全**：动态计算 AP 网卡剩余容量，一键弹窗清单预览并批量补齐空缺槽位。
* **瞬时秒开缓存**：前端采用 10 分钟本地缓存机制，进入页面零白屏秒开，支持右上角穿透缓存手动刷新。

### 2. 🚀 100% 独立自主守护 (告别外部依赖)
* **独立守护进程**：基于 `/etc/init.d/omniclash` procd 进程守护，原生持有真实 PID 监控与自动 respawn 复活。
* **纯 TUN 系统接管**：Mihomo 原生 `device: omniclash` 驱动，Fake-IP (`198.18.0.0/15`) DNS 劫持，全网路由自管理。
* **原生防火墙联动**：自动向 fw4 注入 `omniclash` 虚拟网卡双向放行链，杜绝漏网与网络截胡。

### 3. 🧩 全量数据驱动动态合流编译器 (Data-Driven Engine)
* **外部订阅纯化**：云端订阅 100% 仅作为 `proxy-providers` 节点池拉取，绝不污染或覆盖本地规则与矩阵！
* **分流策略组全景**：预置 42 组完整策略组（自建专线组、地区自动优选组、多应用策略组），支持 UI 自由增删改与恢复默认。
* **六层纯净直达流水线 (Ironclad Pipeline)**：
  1. `Layer 1`: 局域网私网直连 (`private`) 与 Google .cn 防劫持
  2. `Layer 2`: **【全局模式】WiFi 槽位**（`01~08` 等）：最顶层直接锁死出口，零泄漏、零打扰
  3. `Layer 3`: **【定向分流】WiFi 槽位**（`09~16` 等）：国内直连，国外锁死出口，防规则截胡
  4. `Layer 4`: **广告拦截** (`RULE-SET, reject_ad` / `category-ads-all`)：仅供通用分流设备专享，不误杀工作机
  5. `Layer 5`: **业务应用卡片流**：每个场景一张卡片（AI、YouTube、Netflix、Telegram、Google、GitHub、哔哩哔哩、Spotify、巴哈姆特、OneDrive、Microsoft、TikTok、Notion、PayPal、Twitter、Apple），各自绑定出口走向并可自由追加域名/IP 规则；规则按卡片顺序发射，移动卡片即可调整优先级
  6. `Layer 6`: **【通用分流】WiFi 槽位专属出口兜底**
  7. `Layer 7`: 最终 `MATCH` 兜底

### 4. 🖥️ 现代化纯原生 LuCI 界面
* **运行概览**：内核状态徽标、连续运行时间、停止/启动/重启/热重载按钮、Zashboard 打开与一键加速升级。插件版本与核心版本严格分离标准展示。
* **WiFi 矩阵管理**：纯原生数据绑定，10 分钟本地极速缓存直出（零延迟秒开），支持右上角穿透缓存刷新。
* **订阅与分流**：
  * `⚙️ 核心与高级设置`：TUN 模式/堆栈、端口自定义 (7890/1080)、DNS 模式、内核日志等级、Cron 定时重启守护
  * `📦 Provider 订阅集`：表格化行内自由增删改查子订阅 URL 与前缀
  * `🎯 分流节点组`：高对比度清晰全景展示全量 42 个策略组
  * `🔀 应用分流卡片`：三层结构 —— 顶部只读的物理专线隔离保障说明；中部可上下移序的场景卡片（出口下拉、启用开关、展开查看内置规则并自由增删自定义规则、一键新建场景、一键恢复默认库）；底部国内直连与漏网之鱼 MATCH 兜底走向
  * `📄 运行配置 (只读)`：实时只读查看与一键复制最终合流生成的 `/etc/omniclash/run/config.yaml`
* **运行日志**：独立日志大屏，3 秒自动滚动刷新，支持一键清空日志。

---

## 🏗️ 架构拓扑图

```text
[上级光猫 / 广域网]
        │ (WAN: eth0)
        ▼
┌──────────────────────────────────────────────────────────────┐
│ 主路由: J3160 (iStoreOS / OpenWrt 24.10)                     │
│  ├─ omniclash 核心守护进程 (/usr/bin/mihomo)                  │
│  ├─ TUN 虚拟网卡 (198.18.0.0/30) + Fake-IP DNS 劫持 (:1053)   │
│  ├─ Dnsmasq (10000 缓存) + 32 组独立 VLAN DHCP 地址池        │
│  └─ eth1 单臂 Trunk 复用 (主网 + VLAN 101~132)                │
└──────────────────────────────────────────────────────────────┘
        │ (802.1Q VLAN Trunk 盲插网线)
        ▼
┌──────────────────────────────────────────────────────────────┐
│ 纯 AP: 京东云鲁班 RE-CP-02 (ImmortalWrt / OpenWrt)           │
│  ├─ 5G 射频 (MT7915E Wi-Fi 6, 满额 16 槽位): #01 ~ #16       │
│  └─ 2.4G 射频 (MT7915E, 满额 16 槽位):      #17 ~ #32       │
└──────────────────────────────────────────────────────────────┘
```

---

## 📦 安装与语言包

### 软件包说明
* `luci-app-omniclash`: 主体插件包（默认纯英文标准界面）
* `luci-i18n-omniclash-zh-cn`: 简体中文语言包（安装后 LuCI 中文界面自动切换为中文）

### 手动安装 (OPKG)
将编译产出的 IPK 上传到路由器执行：

```bash
# 1. 安装主体插件
opkg install luci-app-omniclash_0.0.1-1_all.ipk

# 2. 安装中文语言包 (可选)
opkg install luci-i18n-omniclash-zh-cn_0.0.1-1_all.ipk
```

### 源码编译进固件 (OpenWrt Buildroot)
克隆本项目至 OpenWrt 源码的 `package/` 或 `feeds/` 目录下：

```bash
cd package/
git clone https://github.com/AkkunYo/luci-app-omniclash.git

make menuconfig
# 进入 LuCI -> Applications -> 选择 luci-app-omniclash 与 luci-i18n-omniclash-zh-cn
make package/luci-app-omniclash/compile V=s
```

---

## 🛠️ 依赖环境

* `OpenWrt` 23.05+ / 24.10+ / `iStoreOS`
* `mihomo` (>= v1.19.0)
* `ucode` (含 `ucode-mod-fs`, `ucode-mod-uci`, `ucode-mod-ubus`)
* `yq` (v4.x)
* `ca-bundle` / `curl`

---

## 📄 开源许可证

本项目基于 **GNU General Public License v3.0 (GPL-3.0)** 许可证开源。

**作者 / 维护者**: [AkkunYo](https://github.com/AkkunYo) (945395054@qq.com)
