include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-omniclash
PKG_VERSION:=0.0.1
PKG_RELEASE:=1

LUCI_TITLE:=LuCI support for OmniClash - Enterprise Mihomo Controller & 32-WiFi AP Matrix
LUCI_DEPENDS:=+mihomo +ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-ubus +yq +sshpass
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
