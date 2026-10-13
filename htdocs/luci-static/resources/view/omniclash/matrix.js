'use strict';
'require view';
'require rpc';
'require fs';
'require ui';

var callGetMatrixRpc = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_matrix',
	
});

var callSaveSlotRpc = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_slot',
	params: [ 'slot' ],
	
});

var callToggleWifiRpc = rpc.declare({
	object: 'luci.omniclash',
	method: 'toggle_wifi',
	params: [ 'sid', 'disabled' ],
	
});

var CACHE_KEY = 'omniclash_matrix_cache';
var CACHE_TTL = 10 * 60 * 1000;

function readMemoryCache() {
	try {
		var raw = window.localStorage ? window.localStorage.getItem(CACHE_KEY) : null;
		if (raw) {
			var parsed = JSON.parse(raw);
			var now = Date.now();
			if (parsed && parsed.timestamp && (now - parsed.timestamp < CACHE_TTL) && parsed.data && parsed.data.slots && parsed.data.slots.length) {
				parsed.data._isFromCache = true;
				parsed.data._cacheTime = parsed.timestamp;
				return parsed.data;
			}
		}
	} catch(e) {}
	return null;
}

function writeMemoryCache(data) {
	try {
		if (window.localStorage && data && data.success && data.slots && data.slots.length) {
			window.localStorage.setItem(CACHE_KEY, JSON.stringify({
				timestamp: Date.now(),
				data: data
			}));
		}
	} catch(e) {}
}

function fetchFreshData() {
	return callGetMatrixRpc().then(function(res) {
		if (res && res.success && res.slots && res.slots.length) return res;
		throw new Error('RPC empty');
	}).catch(function() {
		return fs.exec_direct('/usr/bin/omniclash', ['get_matrix']).then(function(out) {
			try { return JSON.parse(out); } catch(e) { return { success: false }; }
		});
	}).then(function(res) {
		writeMemoryCache(res);
		return res;
	});
}

return view.extend({
	load: function() {
		var cache = readMemoryCache();
		if (cache) {
			return cache;
		}
		return fetchFreshData();
	},

	render: function(res) {
		var slots = (res && res.slots) ? res.slots : [];
		var limits = (res && res.limits) ? res.limits : { '2g': 16, '5g': 16 };

		var count5G = 0;
		var count2G = 0;
		var active5G = 0;
		var active2G = 0;
		var usedNums = {};

		slots.forEach(function(s) {
			var isOff = !!s.disabled;
			if (s.band === '5g') {
				count5G++;
				if (!isOff) active5G++;
			} else if (s.band === '2g') {
				count2G++;
				if (!isOff) active2G++;
			}
			usedNums[parseInt(s.num, 10)] = true;
		});

		var max5G = limits['5g'] || 16;
		var max2G = limits['2g'] || 16;

		var remaining5G = Math.max(0, max5G - count5G);
		var remaining2G = Math.max(0, max2G - count2G);
		var totalRemaining = remaining5G + remaining2G;

		// 强制手动穿透刷新
		window.forceRefreshMatrix = function() {
			try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
			var btn = document.getElementById('omni_refresh_btn');
			if (btn) { btn.innerText = '正在穿透抓取...'; btn.disabled = true; }
			fetchFreshData().then(function() {
				ui.addNotification(null, E('p', {}, _('✅ 缓存已穿透刷新，已同步 AP 与主路由最新状态！')), 'success');
				setTimeout(function() { window.location.reload(); }, 300);
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, err.message), 'error');
				if (btn) { btn.innerText = '🔄 刷新状态 (穿透缓存)'; btn.disabled = false; }
			});
		};

		window.saveSlotWifiOnly = function(sid, num) {
			var ssid = document.getElementById('native_ssid_' + num).value.trim();
			var key = document.getElementById('native_key_' + num).value.trim();

			if (!ssid || key.length < 8) {
				ui.addNotification(null, E('p', {}, _('SSID 不能为空且 WiFi 密码必须至少 8 位！')), 'error');
				return;
			}

			ui.showModal(_('正在保存'), [ E('p', { 'class': 'spinning' }, _('正在双向同步 WiFi #' + num + ' 并平滑重载无线...')) ]);
			var payload = { sid: sid, ssid: ssid, key: key };

			callSaveSlotRpc(payload).then(function() {
				var currentSlot = slots.find(function(s) { return s.sid === sid; });
				if (currentSlot) { currentSlot.ssid = ssid; currentSlot.key = key; }
				writeMemoryCache(res);
				ui.hideModal();
				ui.addNotification(null, E('p', {}, _('✅ WiFi #' + num + ' (' + ssid + ') 名称与密码已双向同步成功！')), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		// 毫秒级软开关切换广播
		window.toggleSlotWifi = function(sid, num, targetDisabled) {
			var actionText = targetDisabled ? '关闭广播' : '开启广播';
			ui.showModal(_('正在切换'), [ E('p', { 'class': 'spinning' }, _('正在毫秒级切换 WiFi #' + num + ' 为 ' + actionText + '...')) ]);

			callToggleWifiRpc(sid, targetDisabled).then(function() {
				try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
				ui.hideModal();
				ui.addNotification(null, E('p', {}, _('✅ WiFi #' + num + ' 已成功' + actionText + '！')), 'success');
				setTimeout(function() { window.location.reload(); }, 600);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		// 【一键加满】预览模态弹窗与执行
		window.openFillAllModal = function() {
			if (totalRemaining <= 0) {
				ui.addNotification(null, E('p', {}, _('当前网卡容量已全部加满 (5G 16/16, 2.4G 16/16)，无需加满！')), 'info');
				return;
			}

			var planList = [];
			var curUsed = Object.assign({}, usedNums);

			// 优先计算 5G 剩余
			for (var i = 0; i < remaining5G; i++) {
				var n5 = 1;
				while (curUsed[n5]) n5++;
				curUsed[n5] = true;
				var n5Str = (n5 < 10 ? '0' : '') + n5;
				planList.push({
					band: '5g',
					num: n5Str,
					vlan: '' + (100 + n5),
					ssid: 'DevNet-' + n5Str,
					key: '12345678',
					mode: '通用分流 (按序兜底)'
				});
			}

			// 计算 2.4G 剩余
			for (var j = 0; j < remaining2G; j++) {
				var n2 = 1;
				while (curUsed[n2]) n2++;
				curUsed[n2] = true;
				var n2Str = (n2 < 10 ? '0' : '') + n2;
				planList.push({
					band: '2g',
					num: n2Str,
					vlan: '' + (100 + n2),
					ssid: 'DevNet-' + n2Str,
					key: '12345678',
					mode: '通用分流 (按序兜底)'
				});
			}

			var modalContent = E('div', { 'style': 'text-align: left; padding: 4px 0;' }, [
				E('div', { 'style': 'background: rgba(59, 130, 246, 0.1); border-left: 4px solid #3b82f6; padding: 10px 14px; border-radius: 4px; margin-bottom: 16px;' }, [
					E('b', { 'style': 'color: #60a5fa; font-size: 14px;' }, _('⚡ 一键补全剩余全部 WiFi (' + totalRemaining + ' 个)')),
					E('p', { 'style': 'color: #94a3b8; margin: 4px 0 0 0; font-size: 12px; line-height: 1.5;' },
						_('系统将全自动联动 AP 物理射频、主路由独立 VLAN 子网、DHCP 池与通用分流链，一键补齐所有空缺名额。')
					)
				]),
				E('div', { 'style': 'max-height: 320px; overflow-y: auto; border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 6px; margin-bottom: 20px;' }, [
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse; margin: 0; font-size: 12px;' }, [
						E('thead', {}, [
							E('tr', { 'style': 'background: rgba(15, 23, 42, 0.5);' }, [
								E('th', { 'style': 'width: 50px; text-align: center;' }, _('槽位')),
								E('th', { 'style': 'width: 75px; text-align: center;' }, _('频段')),
								E('th', {}, _('预设 WiFi 名称 (SSID)')),
								E('th', { 'style': 'width: 85px;' }, _('预设密码')),
								E('th', { 'style': 'width: 140px; text-align: center;' }, _('分配独立 VLAN')),
								E('th', { 'style': 'width: 110px;' }, _('分流走向'))
							])
						]),
						E('tbody', {}, planList.map(function(item) {
							return E('tr', {}, [
								E('td', { 'style': 'text-align: center; font-weight: bold;' }, '#' + item.num),
								E('td', { 'style': 'text-align: center;' }, [
									E('span', { 'class': 'badge', 'style': 'padding: 2px 5px; border-radius: 3px; font-size: 10px; font-weight: bold; color: ' + (item.band === '5g' ? '#7c3aed' : '#0891b2') + '; background: ' + (item.band === '5g' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(6, 182, 212, 0.15)') }, item.band.toUpperCase())
								]),
								E('td', { 'style': 'font-weight: 500;' }, item.ssid),
								E('td', { 'style': 'font-family: monospace;' }, item.key),
								E('td', { 'style': 'text-align: center; font-family: monospace; color: #2563eb; font-weight: 600;' }, 'VLAN ' + item.vlan + ' (' + item.vlan + '.x)'),
								E('td', { 'style': 'color: #10b981; font-size: 11px;' }, item.mode)
							]);
						}))
					])
				]),
				E('div', { 'style': 'display: flex; justify-content: flex-end; gap: 10px; padding-top: 12px; border-top: 1px solid rgba(148, 163, 184, 0.2);' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('取消')),
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': function() {
							ui.showModal(_('正在一键补全全部槽位'), [ E('p', { 'class': 'spinning' }, _('正在初始化补全全量 VLAN、DHCP、AP 射频与规则链，请稍候约 5~8 秒...')) ]);
							fs.exec('/usr/bin/omniclash', ['init_all_32']).then(function() {
								try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
								ui.hideModal();
								ui.addNotification(null, E('p', {}, _('🎉 已成功一键补全全部满额 WiFi 矩阵！')), 'success');
								setTimeout(function() { window.location.reload(); }, 1200);
							}).catch(function(err) {
								ui.hideModal();
								ui.addNotification(null, E('p', {}, err.message), 'error');
							});
						}
					}, _('确认一键补全 (' + totalRemaining + ' 个)'))
				])
			]);

			ui.showModal(_('一键补全剩余全部 WiFi'), modalContent);
		};

		var cacheStatusBadge = '';
		if (res._isFromCache && res._cacheTime) {
			var passedSecs = Math.floor((Date.now() - res._cacheTime) / 1000);
			var passedStr = passedSecs < 60 ? (passedSecs + ' 秒前') : (Math.floor(passedSecs / 60) + ' 分钟前');
			cacheStatusBadge = ' (⚡ 极速缓存已命中，更新于 ' + passedStr + ')';
		}

		var tableRows = slots.map(function(slot) {
			var vlanDisplay = '独立段 (VLAN ' + (slot.vlan || (100 + parseInt(slot.num, 10))) + ')';
			var isOff = !!slot.disabled;

			return E('tr', { 'style': isOff ? 'opacity: 0.6; background: rgba(0,0,0,0.06);' : '' }, [
				E('td', { 'style': 'font-weight: bold; white-space: nowrap; width: 50px; text-align: center; vertical-align: middle;' }, '#' + slot.num),
				E('td', { 'style': 'width: 55px; text-align: center; vertical-align: middle;' }, [
					E('span', { 'class': 'badge', 'style': 'padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: ' + (slot.band === '5g' ? '#7c3aed' : '#0891b2') + '; background: ' + (slot.band === '5g' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(6, 182, 212, 0.15)') }, slot.band.toUpperCase())
				]),
				E('td', { 'style': 'width: 180px;' }, [
					E('input', { 'type': 'text', 'id': 'native_ssid_' + slot.num, 'class': 'cbi-input-text', 'style': 'width: 100%;', 'value': slot.ssid })
				]),
				E('td', { 'style': 'width: 140px;' }, [
					E('input', { 'type': 'text', 'id': 'native_key_' + slot.num, 'class': 'cbi-input-text', 'style': 'width: 100%; font-family: monospace;', 'value': slot.key })
				]),
				E('td', { 'style': 'width: 150px; text-align: center; vertical-align: middle;' }, [
					E('span', {
						'style': 'display: inline-block; padding: 2px 8px; border-radius: 4px; background: rgba(37, 99, 235, 0.1); color: #2563eb; font-family: monospace; font-weight: 600; font-size: 12px;'
					}, vlanDisplay)
				]),
				E('td', { 'style': 'text-align: center; width: 80px; vertical-align: middle;' }, [
					E('span', {
						'class': 'badge',
						'style': 'padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; background: ' + (isOff ? '#94a3b8' : '#10b981')
					}, isOff ? _('已关闭') : _('广播中'))
				]),
				E('td', { 'style': 'text-align: center; width: 70px; vertical-align: middle;' }, [
					E('span', { 'style': 'font-weight: bold; font-size: 13px; color: ' + (slot.clients > 0 ? '#10b981' : '#94a3b8') }, isOff ? '-' : (slot.clients || 0))
				]),
				E('td', { 'style': 'width: 150px; white-space: nowrap; text-align: center; vertical-align: middle;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-apply',
						'style': 'margin-right: 6px;',
						'click': function() { saveSlotWifiOnly(slot.sid, slot.num); }
					}, _('保存')),
					E('button', {
						'class': isOff ? 'cbi-button cbi-button-action' : 'cbi-button cbi-button-neutral',
						'click': function() { toggleSlotWifi(slot.sid, slot.num, !isOff); }
					}, isOff ? _('开启广播') : _('关闭广播'))
				])
			]);
		});

		return E('div', { 'class': 'cbi-map' }, [
			E('div', { 'style': 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding: 6px 0 16px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.15);' }, [
				E('div', {}, [
					E('h2', { 'style': 'margin: 0 0 10px 0; line-height: 1.2;' }, [
						_('OmniClash 无线 AP 矩阵管理'),
						E('span', { 'style': 'font-size: 12px; font-weight: normal; color: #10b981; margin-left: 10px;' }, cacheStatusBadge)
					]),
					E('div', { 'style': 'font-size: 13px; color: #94a3b8; line-height: 1.6; margin-top: 8px;' },
						_('网卡物理容量: 5G 频段 ') + count5G + '/' + max5G + ' (广播中 ' + active5G + ') | 2.4G 频段 ' + count2G + '/' + max2G + ' (广播中 ' + active2G + ')' +
						(totalRemaining > 0 ? (' | ⚡ 剩余可一键补全: ' + totalRemaining + ' 个') : ' | 🎉 已全部满额就绪')
					)
				]),
				E('div', { 'style': 'display: flex; gap: 8px; align-items: center; padding-top: 2px;' }, [
					(totalRemaining > 0) ? E('button', {
						'class': 'cbi-button cbi-button-add',
						'style': 'font-weight: bold; background: #2563eb;',
						'click': window.openFillAllModal
					}, _('⚡ 一键补全 (' + totalRemaining + '个)')) : '',
					E('button', {
						'id': 'omni_refresh_btn',
						'class': 'cbi-button cbi-button-action',
						'click': window.forceRefreshMatrix
					}, _('🔄 刷新状态 (穿透缓存)'))
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse;' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', { 'style': 'width: 50px; text-align: center;' }, _('序号')),
							E('th', { 'style': 'width: 55px; text-align: center;' }, _('频段')),
							E('th', { 'style': 'width: 180px;' }, _('WiFi 名称 (SSID)')),
							E('th', { 'style': 'width: 140px;' }, _('WiFi 密码')),
							E('th', { 'style': 'width: 150px; text-align: center;' }, _('独立 VLAN 网段')),
							E('th', { 'style': 'text-align: center; width: 80px;' }, _('广播状态')),
							E('th', { 'style': 'text-align: center; width: 70px;' }, _('在线设备')),
							E('th', { 'style': 'width: 150px; text-align: center;' }, _('开关与操作'))
						])
					]),
					E('tbody', {}, tableRows.length ? tableRows : [ E('tr', {}, [ E('td', { 'colspan': '8', 'style': 'text-align: center; padding: 24px; color: #94a3b8;' }, _('正在读取 32 满额 AP 矩阵...')) ]) ])
				])
			])
		]);
	}
});
