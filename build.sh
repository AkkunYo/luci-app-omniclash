#!/bin/sh
set -e

# ==============================================================================
# OmniClash 本地构建与打包脚本
# 用法:
#   ./build.sh          -> 本地安装包构建 (自动注入真实私有配置，源码目录保持 100% 干净)
#   ./build.sh --clean  -> 公开发布包构建 (保持通用示例模板，零隐私信息)
# ==============================================================================

PKG_NAME="luci-app-omniclash"
PKG_VERSION="0.0.1"
PKG_RELEASE="1"
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

# 1. 拷贝源码树到临时暂存目录
cp -r "$SCRIPT_DIR/root/"* "$BUILD_DIR/data/"
mkdir -p "$BUILD_DIR/data/www"
cp -r "$SCRIPT_DIR/htdocs/"* "$BUILD_DIR/data/www/"

# 2. 构建期私有覆盖 (动态注入实际配置，绝不改动源码仓库)
if [ "$MODE" = "local" ] && [ -f "$PRIVATE_TPL" ]; then
    echo "-> [私有覆盖] 动态注入本地真实订阅配置: $PRIVATE_TPL"
    cp -f "$PRIVATE_TPL" "$BUILD_DIR/data/etc/omniclash/template.yaml"
else
    echo "-> [开源标准] 使用源码仓库中的通用脱敏模板"
fi

# 3. 生成 conffiles 配置文件保护
cat << 'CONF' > "$BUILD_DIR/control/conffiles"
/etc/config/omniclash
/etc/omniclash/template.yaml
/etc/omniclash/groups.json
/etc/omniclash/rules.json
CONF

# 4. control 元信息
cat << CTRL > "$BUILD_DIR/control/control"
Package: $PKG_NAME
Version: ${PKG_VERSION}-${PKG_RELEASE}
Depends: libc, ucode, ucode-mod-fs, ucode-mod-uci, ucode-mod-ubus, mihomo, yq
Section: luci
Architecture: $PKG_ARCH
Maintainer: AkkunYo <945395054@qq.com>
Description: OmniClash - Enterprise Mihomo Controller & 32-WiFi AP Matrix for OpenWrt/iStoreOS.
CTRL

# 5. postinst 与 prerm 脚本
cat << 'POST' > "$BUILD_DIR/control/postinst"
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
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

# 6. 打包生成 IPK
cd "$BUILD_DIR/data"
tar -czf "$BUILD_DIR/data.tar.gz" *
cd "$BUILD_DIR/control"
tar -czf "$BUILD_DIR/control.tar.gz" *

echo "2.0" > "$BUILD_DIR/debian-binary"
cd "$BUILD_DIR"
FINAL_IPK="$OUTPUT_DIR/${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_${PKG_ARCH}.ipk"
tar -czf "$FINAL_IPK" debian-binary control.tar.gz data.tar.gz

rm -rf "$BUILD_DIR"

echo "=== 构建完成 ==="
ls -lh "$FINAL_IPK"
