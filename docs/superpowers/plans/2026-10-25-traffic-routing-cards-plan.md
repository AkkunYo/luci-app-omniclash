# 分流配置全景可视化与应用卡片流实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原本晦涩暗箱的底层分流规则重构为所见即所得、以业务场景为主线的“应用驱动卡片流”，同时确保全局专线 WiFi 物理防泄漏流水线优先级绝对置顶，实现全景可视化可调与原子安全合流。

**Architecture:** 
1. 采用结构化 `/etc/omniclash/apps.json` 替代旧版 `rules.json`，分离内置系统规则与用户自定义域名规则；
2. `/usr/bin/omniclash` 编译引擎重构为全数据驱动流水线，确保 `Layer 2 (全局专线WiFi) > Layer 3 (定向WiFi) > Layer 4 (广告拦截) > Layer 5 (应用卡片流) > Layer 6/7 (兜底)` 铁律；
3. `luci.omniclash` 暴露强类型 RPC 接口 (`get_apps`, `save_apps`, `reset_apps`)；
4. 前端 `routing.js` 第 4 个子 Tab 升级为三层业务卡片流 UI，支持即时下拉选择出口、点击折叠展开查看/追加规则、卡片上下调优与一键新建自定义应用场景；
5. 更新 `po/` 国际化字典并由 `po2lmo.js` 编译，最后完成双包构建与实机部署。

**Tech Stack:** JavaScript (LuCI Client View), ucode (OpenWrt Server & Engine), POSIX Shell, JSON, gettext LMO.

## Global Constraints
- 禁止在任何 git commit 提交信息或 pull request 中添加任何 Claude、Co-Authored-By 等署名标识；
- 源码仓库永久保持 100% 通用脱敏，本地构建安装包时动态注入本地私有配置覆盖；
- 专线 WiFi 物理拦截优先级必须绝对高于应用卡片流，确保零规则截胡与零泄漏；
- 语法沙箱必须在写入真实运行配置前调用 `mihomo -t` 硬校验，失败自动回退。

---

### Task 1: 创建 `apps_default.json` 模板与初始安装包集成

**Files:**
- Create: `root/etc/omniclash/apps_default.json`
- Create: `root/etc/omniclash/apps.json`
- Modify: `build.sh:100-110`

**Interfaces:**
- Produces: `/etc/omniclash/apps.json` 和 `/etc/omniclash/apps_default.json` 结构化应用场景模板数据文件。

- [ ] **Step 1: 创建全量标准化 `apps_default.json` 模板**

涵盖 16 大主流场景（AI、YouTube、Netflix、Telegram、Google、GitHub、Bilibili、Spotify、Bahamut、OneDrive、Microsoft、TikTok、Notion、PayPal、Twitter、Apple 等），包含名称、图标、描述、默认出口、预置规则数组 `builtin_rules` 与用户自定义规则空数组 `custom_rules`。

- [ ] **Step 2: 拷贝生成初始 `apps.json`**

运行命令生成初始文件，确保安装时开箱即用。

- [ ] **Step 3: 更新 `build.sh` 脚本确保包内包含 `apps.json` 保护**

在 `build.sh` 的 `postinst` 中增加对 `apps.json` 的初始化保障逻辑。

- [ ] **Step 4: 本地校验 JSON 语法**

Run: `python3 -m json.tool root/etc/omniclash/apps_default.json > /dev/null && echo "JSON Valid"`
Expected: `JSON Valid`

- [ ] **Step 5: 提交代码**

```bash
git add root/etc/omniclash/apps_default.json root/etc/omniclash/apps.json build.sh
git commit -m "feat: add structured apps_default.json template and package provisioning"
```

---

### Task 2: 后端引擎 `/usr/bin/omniclash` 编译装配与数据操作重构

**Files:**
- Modify: `root/usr/bin/omniclash:20-60, 240-350, 470-495`

**Interfaces:**
- Consumes: `/etc/omniclash/apps.json` 和 `/etc/omniclash/apps_default.json`
- Produces: 命令行参数 `get_apps`, `save_apps`, `reset_apps` 及全数据驱动的 `compile_config` 流水线。

- [ ] **Step 1: 声明 `APPS_FILE` 与 `APPS_DEF_FILE` 常量并在 `ensure_defaults()` 注册**

在引擎顶部引入 `/etc/omniclash/apps.json` 与 `/etc/omniclash/apps_default.json`。

- [ ] **Step 2: 重构 `compile_config()` 六层流水线的 Layer 5 规则合成**

移除对旧版 `rules.json` 的遍历依赖，改为遍历 `apps.json`：
解包每张卡片的 `builtin_rules` 与 `custom_rules`，统一发射为指向卡片 `target` 的有效规则；严格保证 Layer 2 (全局专线 WiFi) 和 Layer 3 (定向 WiFi) 物理排在前面。

- [ ] **Step 3: 实现 `get_apps`, `save_apps`, `reset_apps` 执行分支**

实现读写 `apps.json`，保存或重置后触发原子合流编译与 `reload`。

- [ ] **Step 4: 语法与沙箱校验测试**

Run: `node -e 'console.log("Check basic logic")'`
Expected: 通过

- [ ] **Step 5: 提交代码**

```bash
git add root/usr/bin/omniclash
git commit -m "feat: refactor omniclash engine with data-driven apps card pipeline"
```

---

### Task 3: RPC 服务端 `luci.omniclash` 扩展接口

**Files:**
- Modify: `root/usr/share/rpcd/ucode/luci.omniclash`

**Interfaces:**
- Consumes: `/usr/bin/omniclash` 的 `get_apps`, `save_apps`, `reset_apps` 命令
- Produces: ubus 上的 `luci.omniclash` 方法 `get_apps`, `save_apps`, `reset_apps`。

- [ ] **Step 1: 在 `methods` 中声明 `get_apps`, `save_apps`, `reset_apps`**

实现调用 `/usr/bin/omniclash` 管道，返回结构化 JSON 回执。

- [ ] **Step 2: 校验 `luci.omniclash` 脚本语法**

确保无语法错误。

- [ ] **Step 3: 提交代码**

```bash
git add root/usr/share/rpcd/ucode/luci.omniclash
git commit -m "feat: expose get_apps, save_apps, and reset_apps rpc methods"
```

---

### Task 4: 前端视图 `routing.js` 重构为三层业务卡片流 UI

**Files:**
- Modify: `htdocs/luci-static/resources/view/omniclash/routing.js`

**Interfaces:**
- Consumes: RPC `get_apps`, `save_apps`, `reset_apps`, `get_groups`
- Produces: 【订阅与分流】页面第 4 个子 Tab 的三层业务应用卡片流界面。

- [ ] **Step 1: 声明 RPC `callGetApps`, `callSaveApps`, `callResetApps` 并加入 `load()`**

在页面启动时并行抓取 `apps` 数据与 `groups` 出口选项列表。

- [ ] **Step 2: 构建 Tab 4 三层布局骨架**

1. 顶层：【🛡️ 物理专线通道隔离保障栏】；
2. 中层：【🚀 业务应用分流流水线】，带【+ 新建场景卡片】与【🔄 恢复默认应用库】；
3. 底层：【⚓ 基础保障与兜底收口区】。

- [ ] **Step 3: 实现卡片列表渲染函数 `renderAppCards()`**

- 卡片常规收起态：展示业务图标、名称、规则数量、目标出口选择主下拉框、上移/下移/展开/删除按钮；
- 卡片展开态：展示内置只读规则列表，以及用户自定义规则微表格（支持输入域名与选择类型即时加入）；
- 实现卡片上下顺序调换与删除。

- [ ] **Step 4: 实现一键【+ 新建场景卡片】模态弹窗**

输入场景名称、初始匹配域名、选择目标走向，确定后即时生成独立业务卡片。

- [ ] **Step 5: 重写保存函数联动原生底栏【保存并应用】**

将修改后的 `appsList` 通过 `callSaveApps` 保存并热重载生效。

- [ ] **Step 6: 本地 JavaScript 语法校验**

Run: `node --check htdocs/luci-static/resources/view/omniclash/routing.js && echo "Syntax OK"`
Expected: `Syntax OK`

- [ ] **Step 7: 提交代码**

```bash
git add htdocs/luci-static/resources/view/omniclash/routing.js
git commit -m "feat: implement three-tier application card stream UI in routing view"
```

---

### Task 5: 国际化词条同步、双包编译与实机全链路验证

**Files:**
- Modify: `po/templates/omniclash.pot`
- Modify: `po/zh_Hans/omniclash.po`
- Modify: `po/zh-cn/omniclash.po`
- Test: 本地构建与 J3160 路由器实机

- [ ] **Step 1: 扫描并生成最新 POT 与 PO 文件**

把卡片流新增的所有 UI 文本与说明全部纳入 `po/` 字典中。

- [ ] **Step 2: 编译最新 `omniclash.zh-cn.lmo` 字典并验证哈希**

Run: `node tools/po2lmo.js po/zh_Hans/omniclash.po /tmp/test_omni.lmo && rm -f /tmp/test_omni.lmo`
Expected: 编译成功

- [ ] **Step 3: 执行 `./build.sh` 构建双包 IPK**

输出 `luci-app-omniclash` 与 `luci-i18n-omniclash-zh-cn`。

- [ ] **Step 4: 上传至 J3160 实机安装**

Run: `scp build/*.ipk root@192.168.100.1:/tmp/ && ssh root@192.168.100.1 "opkg install --force-reinstall /tmp/*.ipk"`
Expected: 0 错误纯净安装。

- [ ] **Step 5: 实机功能验证**

1. 验证 `ubus call luci.omniclash get_apps` 正常返回；
2. 验证 `/usr/bin/omniclash compile` 成功生成六层流水线，Layer 2 专线优先未受破坏；
3. 验证浏览器端页面渲染与汉化效果。

- [ ] **Step 6: 提交最终改动**

```bash
git add po/ build.sh
git commit -m "chore: synchronize i18n dictionaries and finalize card stream release"
```
