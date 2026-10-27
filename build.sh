#!/bin/sh
set -e

# ==============================================================================
# OmniClash 本地构建与打包脚本
# 标准多包支持：
#   1. luci-app-omniclash        (主控插件，标准默认英文)
#   2. luci-i18n-omniclash-zh-cn (标准简体中文语言包)
#   3. omniclash-agent           (子 AP 侧轻量代理，独立安装/卸载)
# 用法:
#   ./build.sh          -> 本地安装包构建 (动态私有覆盖注入真实配置，源码仓库 100% 干净)
#   ./build.sh --clean  -> 公开发布包构建 (保持通用脱敏模板，零隐私信息)
# ==============================================================================

PKG_NAME="luci-app-omniclash"
I18N_PKG_NAME="luci-i18n-omniclash-zh-cn"
AGENT_PKG_NAME="omniclash-agent"
PKG_VERSION="0.0.1"
PKG_RELEASE="1"
AGENT_VERSION="0.1.0"
PKG_ARCH="all"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
BUILD_DIR="/tmp/omniclash_build_staging"
OUTPUT_DIR="$SCRIPT_DIR/build"
PRIVATE_TPL="/Users/zhangkunyang/j3160_luban_backup/j3160/omniclash/template.yaml"

MODE="local"
[ "$1" = "--clean" ] || [ "$1" = "--release" ] && MODE="release"

echo "=== OmniClash 构建模式: $MODE ==="

rm -rf "$BUILD_DIR" "$OUTPUT_DIR"
mkdir -p "$BUILD_DIR/data" "$BUILD_DIR/control" "$OUTPUT_DIR"

# ==============================================================================
# Part A: 打包主体插件 luci-app-omniclash
# ==============================================================================
echo "-> [1/3] 构建主体插件: $PKG_NAME"

# 1. 拷贝源码树到临时暂存目录
cp -r "$SCRIPT_DIR/root/"* "$BUILD_DIR/data/"
mkdir -p "$BUILD_DIR/data/www"
cp -r "$SCRIPT_DIR/htdocs/"* "$BUILD_DIR/data/www/"

# 2. 默认配置动态托管机制 (将默认配置移至 config.default，彻底消除 opkg resolve_conffiles 报警)
mkdir -p "$BUILD_DIR/data/etc/omniclash"
cp -f "$BUILD_DIR/data/etc/config/omniclash" "$BUILD_DIR/data/etc/omniclash/config.default"
rm -f "$BUILD_DIR/data/etc/config/omniclash"

# 2b. 只打包 *_default.json 模板；可写文件由 postinst 首次播种，避免升级覆盖用户数据
for f in groups apps rules wifi_normal; do
    rm -f "$BUILD_DIR/data/etc/omniclash/$f.json"
done

# 3. 构建期私有覆盖 (动态注入实际配置，绝不改动源码仓库)
if [ "$MODE" = "local" ] && [ -f "$PRIVATE_TPL" ]; then
    echo "   [私有覆盖] 动态注入本地真实订阅配置: $PRIVATE_TPL"
    cp -f "$PRIVATE_TPL" "$BUILD_DIR/data/etc/omniclash/template.yaml"
    # 同步对齐分流节点组中的 Provider 引用标识，使之与私有订阅完全一致
    node -e '
        const fs = require("fs");
        for (const f of ["groups.json", "groups_default.json"]) {
            const p = "'"$BUILD_DIR"'/data/etc/omniclash/" + f;
            if (fs.existsSync(p)) {
                let s = fs.readFileSync(p, "utf8");
                s = s.replace(/"sub_provider_1"/g, "\"vpscloud\"")
                     .replace(/"sub_provider_2"/g, "\"hthth\"")
                     .replace(/"sub_provider_3"/g, "\"helloproxy\"")
                     .replace(/"sub_provider_4"/g, "\"githubhy\"");
                fs.writeFileSync(p, s);
            }
        }
    '
else
    echo "   [开源标准] 使用源码仓库中的通用脱敏模板"
fi

# 4. control 元信息
cat << CTRL > "$BUILD_DIR/control/control"
Package: $PKG_NAME
Version: ${PKG_VERSION}-${PKG_RELEASE}
Depends: libc, ucode, ucode-mod-fs, ucode-mod-uci, ucode-mod-ubus, mihomo, yq, sshpass
Section: luci
Architecture: $PKG_ARCH
Maintainer: AkkunYo <945395054@qq.com>
Description: OmniClash - Enterprise Mihomo Controller & 32-WiFi AP Matrix for OpenWrt/iStoreOS.
CTRL

# 5. postinst 与 prerm 脚本
cat << 'POST' > "$BUILD_DIR/control/postinst"
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	# 1. 用户配置首次初始化与平滑增量补全 (100% 保护用户自定义 slot_01~32 与 Wi-Fi)
	if [ ! -f /etc/config/omniclash ]; then
		cp -f /etc/omniclash/config.default /etc/config/omniclash
	else
		for opt in run_mode wireless_mode perf_profile ap_host ap_transport ap_token tcp_mode udp_mode tun_stack bypass_china_mainland_ip dns_mode fake_ip_range mixed_port socks_port log_level scheduled_restart scheduled_restart_cron; do
			val=$(uci -q get omniclash.config.$opt)
			if [ -z "$val" ]; then
				def=$(uci -q -c /etc/omniclash get config.default.config.$opt 2>/dev/null)
				[ -n "$def" ] && uci set omniclash.config.$opt="$def"
			fi
		done
		uci commit omniclash 2>/dev/null || true
	fi
	rm -f /etc/config/omniclash-opkg

	# 2. 规则库与策略组初始化 (仅播种默认库；用户可写文件不随包升级覆盖)
	[ -f /etc/omniclash/groups.json ] || cp -f /etc/omniclash/groups_default.json /etc/omniclash/groups.json
	[ -f /etc/omniclash/apps.json ] || cp -f /etc/omniclash/apps_default.json /etc/omniclash/apps.json
	[ -f /etc/omniclash/wifi_normal.json ] || cp -f /etc/omniclash/wifi_normal_default.json /etc/omniclash/wifi_normal.json

	# 3. 权限与系统守护进程启动
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache
	chmod +x /usr/bin/omniclash
	chmod +x /etc/init.d/omniclash
	chmod 755 /usr/share/rpcd/ucode/luci.omniclash
	chmod 644 /usr/share/rpcd/acl.d/luci-app-omniclash.json
	/etc/init.d/rpcd restart
	/etc/init.d/omniclash enable
	/etc/init.d/omniclash start
	exit 0
}
POST

cat << 'PRERM' > "$BUILD_DIR/control/prerm"
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	/etc/init.d/omniclash stop 2>/dev/null || true
	/etc/init.d/omniclash disable 2>/dev/null || true
	killall -9 mihomo 2>/dev/null || true
	exit 0
}
PRERM
chmod +x "$BUILD_DIR/control/postinst" "$BUILD_DIR/control/prerm"

# 6. 生成主体 IPK
cd "$BUILD_DIR/data"
tar -czf "$BUILD_DIR/data.tar.gz" *
cd "$BUILD_DIR/control"
tar -czf "$BUILD_DIR/control.tar.gz" *

echo "2.0" > "$BUILD_DIR/debian-binary"
cd "$BUILD_DIR"
MAIN_IPK="$OUTPUT_DIR/${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_${PKG_ARCH}.ipk"
tar -czf "$MAIN_IPK" debian-binary control.tar.gz data.tar.gz

# ==============================================================================
# Part B: 打包中文语言包插件 luci-i18n-omniclash-zh-cn
# ==============================================================================
echo "-> [2/3] 构建中文语言包: $I18N_PKG_NAME"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/data/usr/lib/lua/luci/i18n" "$BUILD_DIR/control"

# 1. 编译 po 文件为 lmo 二进制
PO_FILE="$SCRIPT_DIR/po/zh_Hans/omniclash.po"
LMO_FILE="$BUILD_DIR/data/usr/lib/lua/luci/i18n/omniclash.zh-cn.lmo"

if [ -f "$PO_FILE" ]; then
    node "$SCRIPT_DIR/tools/po2lmo.js" "$PO_FILE" "$LMO_FILE"
else
    echo "Warning: $PO_FILE not found, skipping LMO compilation!"
fi

# 2. 语言包 control 元信息
cat << CTRL_I18N > "$BUILD_DIR/control/control"
Package: $I18N_PKG_NAME
Version: ${PKG_VERSION}-${PKG_RELEASE}
Depends: libc, $PKG_NAME
Section: luci
Architecture: $PKG_ARCH
Maintainer: AkkunYo <945395054@qq.com>
Description: Translation for luci-app-omniclash - 简体中文 (Chinese Simplified)
CTRL_I18N

# 3. 语言包 postinst 清除缓存
cat << 'POST_I18N' > "$BUILD_DIR/control/postinst"
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache
	exit 0
}
POST_I18N
chmod +x "$BUILD_DIR/control/postinst"

# 4. 生成语言包 IPK
cd "$BUILD_DIR/data"
tar -czf "$BUILD_DIR/data.tar.gz" *
cd "$BUILD_DIR/control"
tar -czf "$BUILD_DIR/control.tar.gz" *

echo "2.0" > "$BUILD_DIR/debian-binary"
cd "$BUILD_DIR"
I18N_IPK="$OUTPUT_DIR/${I18N_PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_${PKG_ARCH}.ipk"
tar -czf "$I18N_IPK" debian-binary control.tar.gz data.tar.gz

rm -rf "$BUILD_DIR"

# ==============================================================================
# Part C: 打包子 AP 代理 omniclash-agent
#
# 这是一个"只装一次、装完即忘"的极简包：
#   - 新增 /www/cgi-bin/omniclash-agent（ucode CGI）
#   - 新增 /etc/omniclash-agent/token（首次安装随机生成）
#   - 不改动 wireless / network / firewall 中的任何既有配置
#   - 不带 init 脚本，无常驻进程，卸载后不残留
# 依赖只用子 AP 上原本就有的 uhttpd + ucode + uci。
# ==============================================================================
echo "-> [3/3] 构建子 AP 代理: $AGENT_PKG_NAME"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/data" "$BUILD_DIR/control"

cp -r "$SCRIPT_DIR/agent/root/"* "$BUILD_DIR/data/"
chmod 755 "$BUILD_DIR/data/www/cgi-bin/omniclash-agent"
chmod 755 "$BUILD_DIR/data/etc/uci-defaults/99-omniclash-agent"

cat << CTRL_AGENT > "$BUILD_DIR/control/control"
Package: $AGENT_PKG_NAME
Version: ${AGENT_VERSION}-${PKG_RELEASE}
Depends: libc, ucode, uhttpd
Section: net
Architecture: $PKG_ARCH
Maintainer: AkkunYo <945395054@qq.com>
Description: OmniClash Agent - lightweight wireless control endpoint for a child OpenWrt AP.
CTRL_AGENT

cat << 'POST_AGENT' > "$BUILD_DIR/control/postinst"
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	chmod 755 /www/cgi-bin/omniclash-agent 2>/dev/null || true
	# uci-defaults 通常由 rc.common 统一执行；这里显式跑一次以防边缘情况
	[ -x /etc/uci-defaults/99-omniclash-agent ] && /etc/uci-defaults/99-omniclash-agent && rm -f /etc/uci-defaults/99-omniclash-agent
	exit 0
}
POST_AGENT

cat << 'PRERM_AGENT' > "$BUILD_DIR/control/prerm"
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	# 卸载只移除端点本身；已下发的无线配置原样保留，网络不受影响
	rm -f /www/cgi-bin/omniclash-agent 2>/dev/null || true
	exit 0
}
PRERM_AGENT
chmod +x "$BUILD_DIR/control/postinst" "$BUILD_DIR/control/prerm"

cd "$BUILD_DIR/data"
tar -czf "$BUILD_DIR/data.tar.gz" *
cd "$BUILD_DIR/control"
tar -czf "$BUILD_DIR/control.tar.gz" *

echo "2.0" > "$BUILD_DIR/debian-binary"
cd "$BUILD_DIR"
AGENT_IPK="$OUTPUT_DIR/${AGENT_PKG_NAME}_${AGENT_VERSION}-${PKG_RELEASE}_${PKG_ARCH}.ipk"
tar -czf "$AGENT_IPK" debian-binary control.tar.gz data.tar.gz

rm -rf "$BUILD_DIR"

echo "=== 构建全部完成 ==="
ls -lh "$OUTPUT_DIR"
