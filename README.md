# luci-app-omniclash

**English** | [简体中文](README_ZH.md)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![OpenWrt Version](https://img.shields.io/badge/OpenWrt-23.05%20%7C%2024.10%20%7C%20iStoreOS-brightgreen.svg)](https://openwrt.org/)
[![Architecture](https://img.shields.io/badge/Arch-All%20(x86_64%20%7C%20ARM%20%7C%20MIPS)-orange.svg)](https://github.com/AkkunYo/luci-app-omniclash)
[![Core](https://img.shields.io/badge/Core-Mihomo%20Meta%20(TUN%20Mode)-red.svg)](https://github.com/MetaCubeX/mihomo)

**OmniClash** is an enterprise-grade, all-in-one network routing and proxy control suite designed specifically for OpenWrt and iStoreOS. It integrates a **standalone Mihomo (Meta) system daemon**, a **32-slot wireless AP hardware matrix with bidirectional sync**, and a **purely data-driven, dynamic configuration compilation engine**.

Following official OpenWrt ecosystem packaging standards, the base package `luci-app-omniclash` defaults to standard English, while simplified Chinese support is provided via the official companion package `luci-i18n-omniclash-zh-cn`.

---

## 🌟 Key Features & Architecture Highlights

### 1. 📶 32-Slot Wireless AP Hardware Matrix (Bidirectional Sync)
* **Hardware Capacity Resident by Default**: 5G Wi-Fi 6 (16 slots, `#01~#16`) + 2.4G (16 slots, `#17~#32`) fully populated.
* **Strict Physical VLAN Isolation**: 32 dedicated VLAN subnets (`VLAN 101` ~ `132`) and independent DHCP pools reside permanently across the network.
* **Real Chipset Bidirectional Sync**: Automatically detects real active BSSIDs, online client counts, and physical broadcast state from AP radios.
* **Sub-millisecond Soft Switches**: Toggle on-air SSID broadcast in milliseconds without restarting wireless interfaces or losing configuration.
* **⚡ One-Click Fill All**: Dynamically evaluates available hardware capacity, previews slot plans in a modal, and provisions remaining slots in batch.
* **Instant Client-Side Cache**: Employs a 10-minute local cache mechanism for instant zero-latency loading, with a manual bypass-cache refresh button.

### 1b. 🔗 AC + AP Distributed Control (omniclash-agent)
* **Structured RPC, Not SSH Scripts**: The child AP runs a tiny JSON endpoint (`/cgi-bin/omniclash-agent`); the controller sends structured requests instead of concatenated shell strings.
* **No SSH Password Needed**: Access is authenticated with a per-AP bearer token, so joining a brand-new AP no longer requires knowing its root password.
* **Zero-Touch Direct Installation**: The main router hosts `omniclash-agent.ipk` statically; run a single `wget` command on the child AP to install directly.
* **LAN Auto-Discovery**: One-click concurrent probe across the primary LAN subnet to discover active child APs by hostname/board and fill the IP address automatically.
* **Live Client Profiling**: Clicking the active client count on any WiFi slot opens an on-demand modal revealing device hostname, IP, MAC, signal strength (RSSI), physical bitrate (Tx/Rx), and assigned proxy egress.
* **Automatic Fallback**: If the agent is not installed, the controller transparently falls back to SSH — behaviour is byte-identical to the previous release.
* **~3× Faster Refresh**: Full 32-slot status refresh drops from ~2.0s to ~0.6s.
* **Provably Safe with Self-Healing**: The agent only ever writes `wireless` UCI, includes an autonomous watchdog rollback for network reloads, and never causes unrecoverable disconnection.

### 2. 🚀 100% Standalone System Daemon
* **Independent Procd Service**: Managed via `/etc/init.d/omniclash` procd instance with native PID monitoring and automatic respawn.
* **Pure TUN Kernel Takeover**: Native Mihomo `device: omniclash` driver, Fake-IP (`198.18.0.0/15`) DNS hijacking, and self-managed route table 2022.
* **Native Firewall Integration**: Automatically injects bidirectional accept chains into fw4 (`inet fw4`) for the `omniclash` interface, preventing packet interception.

### 3. 🧩 Fully Data-Driven Dynamic Compilation Engine
* **Purified External Subscriptions**: Remote subscriptions are strictly treated as `proxy-providers` node pools, never overwriting or corrupting local rules or AP mappings!
* **Structured Proxy Groups**: Pre-configured with 42 proxy groups (dedicated lines, auto-test regions, application routing), fully editable via UI with one-click restore.
* **Ironclad 6-Tier Routing Pipeline**:
  1. `Layer 1`: LAN & private subnet direct connection (`private`) and Google .cn anti-hijacking.
  2. `Layer 2`: **Global Mode WiFi Slots** (`01~08`, etc.): Top-tier interception strictly locked to dedicated proxies; zero leaks, zero disturbance.
  3. `Layer 3`: **Targeted Mode WiFi Slots** (`09~16`, etc.): Domestic traffic direct, foreign traffic strictly sent to dedicated egress, preventing subsequent rule interference.
  4. `Layer 4`: **Ad Blocking** (`RULE-SET, reject_ad` / `category-ads-all`): Exclusively active for general devices; never interferes with dedicated development machines.
  5. `Layer 5`: **Application Card Pipeline**: One card per scenario (AI, YouTube, Netflix, Telegram, Google, GitHub, Bilibili, Spotify, Bahamut, OneDrive, Microsoft, TikTok, Notion, PayPal, Twitter, Apple), each binding its own egress target plus user-added domains/IPs. Rules are emitted in card order, so priority is reordered by moving cards.
  6. `Layer 6`: **General Routing WiFi Fallback**: Unmatched foreign traffic routed via respective assigned proxy nodes.
  7. `Layer 7`: Final `MATCH` fallback.

### 4. 🖥️ Modern Native LuCI Interface
* **Overview**: Core status badge, continuous uptime, start/stop/restart/reload buttons, Zashboard launch, and one-click core update. App Version and Core Version are clearly separated.
* **WiFi AP Matrix**: Native data binding with 10-minute instant local cache and manual cache-bypass refresh.
* **Subscription & Routing**:
  * `⚙️ Core Settings`: TUN mode/stack, port customization (7890/1080), DNS mode, core log level, cron scheduled restart.
  * `📦 Provider Subscriptions`: Editable inline table for provider URLs, tags, and prefixes.
  * `🎯 Proxy Groups`: High-contrast overview of all 42 structured proxy groups.
  * `🔀 Application Routing Cards`: Three-tier card stream — a read-only physical-line isolation banner, the reorderable scenario cards (egress dropdown, enable toggle, expandable built-in + custom rules, new-card modal, one-click restore), and a baseline zone for the CN-direct and terminal MATCH targets.
  * `📄 Running Config (Read-only)`: Real-time viewer and one-click copy of the compiled `/etc/omniclash/run/config.yaml`.
* **Live Logs**: Dedicated log viewer with 3-second auto-scroll polling and one-click log clearing.

---

## 🏗️ Network Architecture Topology

```text
[Modem / WAN Uplink]
        │ (WAN: eth0)
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Main Router: J3160 (iStoreOS / OpenWrt 24.10)                │
│  ├─ omniclash core daemon (/usr/bin/mihomo)                  │
│  ├─ TUN virtual interface (198.18.0.0/30) + Fake-IP DNS      │
│  ├─ Dnsmasq (10000 cache) + 32 dedicated VLAN DHCP pools     │
│  └─ eth1 single-arm trunk (Main LAN + VLAN 101~132)          │
└──────────────────────────────────────────────────────────────┘
        │ (802.1Q VLAN Trunk Cable)
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Pure AP: Luban RE-CP-02 (ImmortalWrt / OpenWrt)              │
│  ├─ 5G Radio (MT7915E Wi-Fi 6, 16 Slots): #01 ~ #16          │
│  └─ 2.4G Radio (MT7915E, 16 Slots):      #17 ~ #32          │
└──────────────────────────────────────────────────────────────┘
```

---

## 📦 Packages & Installation

### Package Structure
* `luci-app-omniclash`: Core application package (default English interface). Install on the **main router / AC**.
* `luci-i18n-omniclash-zh-cn`: Simplified Chinese language pack (automatically applied when LuCI language is Chinese).
* `omniclash-agent`: Lightweight control endpoint for a **child AP**. Optional, but recommended — install once on the AP and the controller stops needing SSH.

### Manual Installation (OPKG)
Upload the built `.ipk` packages to your router:

```bash
# 1. Install base application (on the main router)
opkg install luci-app-omniclash_0.0.1-1_all.ipk

# 2. Install Chinese language pack (optional)
opkg install luci-i18n-omniclash-zh-cn_0.0.1-1_all.ipk

# 3. Install the agent on the CHILD AP (optional, recommended)
#    Copy omniclash-agent_0.1.0-1_all.ipk to the AP first.
opkg install omniclash-agent_0.1.0-1_all.ipk
cat /etc/omniclash-agent/token     # paste this into the controller UI
```

Installing the agent does **not** restart any network service and does not modify
`wireless`, `network`, `dhcp` or `firewall`. Uninstalling it likewise leaves all
already-pushed Wi-Fi interfaces in place.

### Build from Source (OpenWrt Buildroot)
Clone this repository into your OpenWrt SDK `package/` or `feeds/` directory:

```bash
cd package/
git clone https://github.com/AkkunYo/luci-app-omniclash.git

make menuconfig
# Select LuCI -> Applications -> luci-app-omniclash (and luci-i18n-omniclash-zh-cn)
make package/luci-app-omniclash/compile V=s
```

---

## 🛠️ Prerequisites & Dependencies

* `OpenWrt` 23.05+ / 24.10+ / `iStoreOS`
* `mihomo` (>= v1.19.0)
* `ucode` (with `ucode-mod-fs`, `ucode-mod-uci`, `ucode-mod-ubus`)
* `yq` (v4.x)
* `ca-bundle` / `curl`

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.

**Author / Maintainer**: [AkkunYo](https://github.com/AkkunYo) (945395054@qq.com)
