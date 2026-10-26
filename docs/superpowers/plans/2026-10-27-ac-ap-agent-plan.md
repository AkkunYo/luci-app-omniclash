# AC + AP Agent 实施计划

日期：2026-10-27
规格：`docs/superpowers/specs/2026-10-27-omniclash-ac-ap-agent-design.md`

## 安全底线（每个任务都必须遵守）

1. 任何一步都不得执行 `network reload`、`/etc/init.d/network restart`、`reboot`、`wifi down`。
2. 安装 agent 只新增文件，不改 AP 既有 `wireless`/`network`/`firewall` 配置。
3. 每个写操作前备份 `uci export wireless`，失败时不 commit。
4. 部署顺序固定：**先在 AP 本地 127.0.0.1 自测 → 再从 AC 远程测 → 最后切默认通道**。
5. 主控改造必须保留 SSH 回退；`ap_transport` 默认 `auto`，探测失败即回落。
6. 全程保持 AC→AP 的 SSH 可用，作为断网时的救援通道。

---

## Task 1：agent 包骨架与 ping

新目录 `agent/`，产出 IPK `omniclash-agent`。

- `agent/root/www/cgi-bin/omniclash-agent`：ucode CGI，分发 `method`
- `agent/root/etc/omniclash-agent/token`：postinst 生成，`chmod 600`
- `agent/root/etc/init.d/`：无（不常驻）

先只实现 `ping`（返回 version/hostname/board/token_ok）。
在 AP 上 `curl 127.0.0.1/cgi-bin/omniclash-agent` 自测。

验收：无 token 时 `ping` 返回 `token_ok:false`；带正确 token 返回 `token_ok:true`。

## Task 2：get_wifi 上报

- 枚举 `wireless` 中 `mode=ap` 的段，取 section/ssid/key/network/device/disabled/encryption
- `iw dev` 统计每接口客户端数
- `iw phy` 读取每射频 AP 上限
- 全部用 ucode API，不拼 shell 命令字符串

验收：字段与 AP 上 `uci show wireless` 逐项一致；32 接口场景下响应 < 1s。

## Task 3：set_wifi / bulk_set_wifi / reload_wifi

- 校验：section 白名单正则、SSID ≤32B、PSK ≤63B、encryption 枚举
- 幂等：新旧值相同则 `changed:false` 且不 commit
- 原子：bulk 先全量校验，任一失败返回 `failed[]` 且不写盘
- 写后 `wifi reload`

验收：恶意 section（`../../etc/passwd`、空、大写）全部拒绝；连发两次第二次 `changed:false`。

## Task 4：provision_vlan

把现有 `reset_matrix_32` 里那套 VLAN + 桥 + wifi-iface 逻辑搬到 agent，
由 agent 在本机执行（不再 SSH 远程跑脚本）。

验收：32 槽位全量下发后，AP 上 `uci show wireless` 与下发内容一致，
且 AP 的 `network`/`dhcp`/`firewall` 段未被改动（diff 为空）。

## Task 5：主控双通道

`/usr/bin/omniclash` 新增：

- `agent_call(method, params)`：curl POST，带 token，超时 5s
- `agent_available()`：`ping` 探测 + 结果缓存（进程内）
- `wireless_exec()` / `ap_exec()`：`ap` 模式下优先走 agent，失败回落 SSH
- `get_matrix` 改走 `agent_call("get_wifi")`，输出保持原有 JSON 结构不变

新增 uci：`ap_transport = auto|agent|ssh`、`ap_token`。

验收：卸载 agent 后行为与改造前一致；装上后 32 槽位刷新 < 1.5s。

## Task 6：UI 通道状态

matrix 页子 AP 弹窗增加通道状态行（Agent vX / SSH 兼容模式）+ 一键诊断，
显示所用通道与探测延迟。

验收：语言包双包编译通过，中英文均有对应词条。

## Task 7：构建与实机验证

- `build.sh` 增加第三个包
- 分级部署：先只装 agent（不改 AC 行为）→ 验证 → 再装新 AC 包
- 验证项见规格第 9 节

验收：全程 SSH 通道保持可用；任何失败可用 `omniclash-agent` 卸载或
`/etc/omniclash-agent/wireless.bak` 恢复。
