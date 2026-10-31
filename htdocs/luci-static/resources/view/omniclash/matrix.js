'use strict';
'require view';
'require rpc';
'require uci';
'require fs';
'require dom';
'require ui';
'require omniclash.ui as ocui';

var callGetStatus = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_status'
});

var callGetMatrixRpc = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_matrix'
});

var callSaveSlotRpc = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_slot',
	params: [ 'slot' ]
});

var callToggleWifiRpc = rpc.declare({
	object: 'luci.omniclash',
	method: 'toggle_wifi',
	params: [ 'sid', 'disabled' ]
});

var callSaveWifiNormalRpc = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_wifi_normal',
	params: [ 'items' ]
});

var callResetWifiNormalRpc = rpc.declare({
	object: 'luci.omniclash',
	method: 'reset_wifi_normal'
});

var callResetMatrix32Rpc = rpc.declare({
	object: 'luci.omniclash',
	method: 'reset_matrix_32'
});

var callAgentStatus = rpc.declare({
	object: 'luci.omniclash',
	method: 'agent_status',
	params: [ 'host', 'token' ]
});

var callSaveApConfig = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_ap_config',
	params: [ 'host', 'token' ]
});

var callSaveWirelessMode = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_wireless_mode',
	params: [ 'mode', 'run_mode' ]
});

var callSyncMatrix = rpc.declare({
	object: 'luci.omniclash',
	method: 'sync_matrix',
	params: [ 'dry_run' ]
});

var callApplyApNetwork = rpc.declare({
	object: 'luci.omniclash',
	method: 'apply_ap_network'
});

var callDiscoverAp = rpc.declare({
	object: 'luci.omniclash',
	method: 'discover_ap'
});

var callSaveSlotRoute = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_slot_route',
	params: [ 'sid', 'mode', 'target' ]
});

var callGetSlotClients = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_slot_clients',
	params: [ 'sid' ]
});

var CACHE_KEY = 'omniclash_matrix_cache_v4';
var CACHE_TTL = 10 * 60 * 1000;

/**
 * RPC 现在会把引擎的真实结果透传上来。只有 success !== false 才算成功，
 * 否则转为 rejection，交给调用方的 catch 统一弹错误提示。
 */
function ensureRpcOk(res, fallbackMsg) {
	if (res && res.success === false)
		throw new Error(res.error || fallbackMsg || _('Operation failed'));
	return res;
}

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

window.applyApNetwork = function() {
	if (!confirm(_('Reload the child AP network configuration now?\nThe AP will briefly drop off the network. If it does not come back within the grace period, it restores the previous configuration by itself.'))) return;

	ui.showModal(_('Reloading AP Network'), [ E('p', { 'class': 'spinning' }, _('Applying network configuration on the child AP and waiting for it to come back...')) ]);

	callApplyApNetwork().then(function(res) {
		ui.hideModal();
		if (res && res.success) {
			ui.addNotification(null, E('p', {},
				'✅ ' + _('Child AP network applied (back in %d s).').replace('%d', res.waited_sec || 0)
			), 'success');
		} else {
			ui.addNotification(null, E('p', {},
				'⚠️ ' + (res && res.error ? res.error : _('Child AP did not come back; it will self-restore.'))
			), 'warning');
		}
		setTimeout(function() { window.location.reload(); }, 1500);
	}).catch(function(err) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, err.message), 'error');
	});
};

window.syncMatrixToAp = function() {
	if (!confirm(_('Push the 32-slot wireless configuration to the child AP?\nOnly wireless interfaces are touched; AP networks and firewall stay unchanged.'))) return;

	ui.showModal(_('Syncing to Child AP'), [ E('p', { 'class': 'spinning' }, _('Checking for differences before overwriting the child AP...')) ]);

	/* 下推前先做一次 dry-run：子 AP 上被手工改过的 SSID 会被本机记录覆盖，
	 * 必须先让用户看到差异（Xiaomi_ZMY 就是这样丢过一次）。 */
	callSyncMatrix(true).then(function(pre) {
		ensureRpcOk(pre, _('Failed to sync to child AP'));
		var conflicts = (pre && pre.conflicts) ? pre.conflicts : [];

		if (conflicts.length) {
			var lines = conflicts.map(function(c) {
				return E('li', {}, '#' + c.slot + ' ' + c.section + ': ' + c.ap_ssid + ' → ' + c.cfg_ssid);
			});
			ui.showModal(_('Overwrite Confirmation'), [
				E('p', {}, '⚠️ ' + _('The child AP has Wi-Fi names that differ from this router. Continuing will overwrite them:')),
				E('ul', { 'style': 'margin: 8px 0 12px 20px; font-size: 13px;' }, lines),
				E('p', { 'style': 'color: var(--oc-fg-2); font-size: 13px;' },
					_('To keep a name, change the slot SSID on this router first, then push again.')),
				E('div', { 'class': 'right', 'style': 'margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px;' }, [
					E('button', { 'type': 'button', 'class': 'cbi-button', 'click': function() { ui.hideModal(); } }, _('Cancel')),
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-apply',
						'click': function() { ui.hideModal(); window.doPushMatrix(); }
					}, _('Overwrite Anyway'))
				])
			]);
			return;
		}

		window.doPushMatrix();
	}).catch(function(err) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, err.message), 'error');
	});
};

window.doPushMatrix = function() {
	ui.showModal(_('Syncing to Child AP'), [ E('p', { 'class': 'spinning' }, _('Upserting wireless interfaces on the child AP...')) ]);

	callSyncMatrix(false).then(function(res) {
		ensureRpcOk(res, _('Failed to sync to child AP'));
		try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
		ui.hideModal();
		ui.addNotification(null, E('p', {},
			'✅ ' + _('Child AP synced: %d wireless interface(s) applied via %s.')
				.replace('%d', res.applied || 0)
				.replace('%s', res.via || 'agent')
		), 'success');
		setTimeout(function() { window.location.reload(); }, 900);
	}).catch(function(err) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, err.message), 'error');
	});
};

window.refreshAgentStatus = function() {
	var fb = document.getElementById('modal_agent_status');
	var btn = document.getElementById('modal_btn_agent_probe');
	var hostEl = document.getElementById('modal_ap_host');
	var tokenEl = document.getElementById('modal_ap_token');

	var host = hostEl ? hostEl.value.trim() : '';
	var token = tokenEl ? tokenEl.value.trim() : '';

	if (btn) { btn.disabled = true; btn.innerText = _('Testing...'); }
	if (fb) dom.content(fb, E('span', { 'class': 'spinning' }, _('Probing control channel...')));

	callAgentStatus(host, token).then(function(res) {
		if (btn) { btn.disabled = false; btn.innerText = '🔌 ' + _('Test Connection'); }
		var ok = res && res.available;
		if (!fb) return;
		var color = ok ? '#059669' : '#dc2626';
		var text = ok
			? ('🟢 ' + _('Agent channel ready (v%s, %d ms)').replace('%s', res.version || '?').replace('%d', res.latency_ms || 0))
			: ('🔴 ' + _('Agent unavailable: %s').replace('%s', res && res.error ? res.error : _('no response')));
		dom.content(fb, E('span', { 'style': 'color: ' + color + '; font-weight: 500;' }, text));
	}).catch(function(err) {
		if (btn) { btn.disabled = false; btn.innerText = '🔌 ' + _('Test Connection'); }
		if (fb) dom.content(fb, E('span', { 'style': 'color: #dc2626; font-weight: 500;' }, '🔴 ' + err.message));
	});
};


window.discoverChildAps = function() {
	var box = document.getElementById('modal_discovered_devices');
	var btn = document.getElementById('modal_btn_discover');
	if (btn) { btn.disabled = true; btn.innerText = _('Scanning...'); }
	if (box) dom.content(box, E('span', { 'class': 'spinning', 'style': 'color: #3b82f6; font-size: 12px; margin-top: 6px; display: inline-block;' }, _('Scanning LAN for child APs...')));

	callDiscoverAp().then(function(res) {
		if (btn) { btn.disabled = false; btn.innerText = '🔍 ' + _('Auto Scan AP'); }
		var devices = (res && res.devices) ? res.devices : [];
		if (!box) return;

		if (!devices.length) {
			dom.content(box, E('div', { 'style': 'color: var(--oc-fg-3); font-size: 12px; margin-top: 6px;' }, _('No child APs running omniclash-agent detected on LAN.')));
			return;
		}

		var devCards = devices.map(function(d) {
			return E('div', {
				'style': 'display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; margin-top: 6px; background: rgba(59, 130, 246, 0.06); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 6px;'
			}, [
				E('div', { 'style': 'display: flex; align-items: center; gap: 8px;' }, [
					E('span', { 'style': 'font-size: 15px;' }, '📶'),
					E('b', { 'style': 'font-size: 13px; color: var(--oc-fg);' }, d.hostname || d.ip),
					E('span', { 'style': 'color: var(--oc-fg-2); font-size: 12px; font-family: monospace;' }, d.ip),
					d.version ? E('span', { 'style': 'color: #7c3aed; font-size: 11px; background: rgba(124, 58, 237, 0.1); padding: 1px 5px; border-radius: 3px;' }, 'v' + d.version) : ''
				]),
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-action',
					'style': 'padding: 2px 10px; font-size: 12px; margin: 0;',
					'click': function() {
						var el = document.getElementById('modal_ap_host');
						if (el) el.value = d.ip;
						window.refreshAgentStatus();
					}
				}, _('Select'))
			]);
		});

		dom.content(box, [
			E('div', { 'style': 'font-size: 12px; color: #059669; font-weight: 500; margin-top: 6px;' },
				_('Discovered %d AP(s) on LAN:').replace('%d', devices.length)),
			E('div', { 'style': 'margin-top: 2px;' }, devCards)
		]);
	}).catch(function(err) {
		if (btn) { btn.disabled = false; btn.innerText = '🔍 ' + _('Auto Scan AP'); }
		if (box) dom.content(box, E('span', { 'style': 'color: #dc2626; font-size: 12px; margin-top: 6px; display: inline-block;' }, '🔴 ' + err.message));
	});
};

window.openSlotClientsModal = function(sid, num, ssid) {
	ui.showModal(_('Slot #%s Clients Profile').replace('%s', num), [
		E('p', { 'class': 'spinning' }, _('Fetching live client hardware metrics from child AP...'))
	]);

	callGetSlotClients(sid).then(function(res) {
		ensureRpcOk(res, _('Failed to fetch slot clients'));
		var clients = (res && res.clients) ? res.clients : [];
		if (!clients.length) {
			ui.showModal(_('Slot #%s Clients Profile').replace('%s', num), [
				E('div', { 'style': 'padding: 24px; text-align: center; color: var(--oc-fg-2); font-size: 13px;' }, [
					E('span', { 'style': 'font-size: 24px; display: block; margin-bottom: 8px;' }, '📶'),
					_('No active clients currently associated with this slot.')
				]),
				E('div', { 'class': 'right', 'style': 'margin-top: 12px; display: flex; justify-content: flex-end;' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Close'))
				])
			]);
			return;
		}

		function formatDuration(secs) {
			if (!secs || secs < 60) return (secs || 0) + 's';
			var mins = Math.floor(secs / 60);
			if (mins < 60) return mins + 'm ' + (secs % 60) + 's';
			var hrs = Math.floor(mins / 60);
			return hrs + 'h ' + (mins % 60) + 'm';
		}

		function formatRate(raw) {
			if (!raw) return '-';
			var speed = raw.split(' ')[0] + ' Mbps';
			var modeMatch = raw.match(/((?:HE|VHT|HT)-MCS\s*\d+)/);
			if (modeMatch) return speed + ' (' + modeMatch[1] + ')';
			return speed;
		}

		function signalBadge(sig) {
			var color = '#10b981';
			var label = _('Excellent');
			if (sig < -75) { color = '#ef4444'; label = _('Weak'); }
			else if (sig < -65) { color = '#f59e0b'; label = _('Fair'); }
			else if (sig < -55) { color = '#3b82f6'; label = _('Good'); }
			return E('span', {
				'style': 'display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; color: ' + color + '; background: rgba(0,0,0,0.05);'
			}, [
				E('span', { 'style': 'width: 6px; height: 6px; border-radius: 50%; background: ' + color + ';' }),
				sig + ' dBm (' + label + ')'
			]);
		}

		var clientCards = clients.map(function(c) {
			var txStr = formatRate(c.tx_rate);
			var rxStr = formatRate(c.rx_rate);
			return E('div', {
				'style': 'padding: 12px 14px; margin-bottom: 10px; border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 8px; background: var(--oc-bg-2);'
			}, [
				E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;' }, [
					E('div', { 'style': 'display: flex; align-items: center; gap: 8px;' }, [
						E('span', { 'style': 'font-size: 16px;' }, '📱'),
						E('b', { 'style': 'font-size: 14px; color: var(--oc-fg);' }, c.hostname || _('Unknown Device')),
						c.ip ? E('span', { 'style': 'font-size: 12px; font-family: monospace; color: #2563eb; background: rgba(37, 99, 235, 0.1); padding: 1px 6px; border-radius: 4px;' }, c.ip) : ''
					]),
					signalBadge(c.signal)
				]),
				E('div', {
					'style': 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; font-size: 12px; color: var(--oc-fg-2); background: var(--oc-bg-2); padding: 8px 10px; border-radius: 6px;'
				}, [
					E('div', {}, [ E('span', { 'style': 'color: var(--oc-fg-3);' }, _('MAC Address') + ': '), E('span', { 'style': 'font-family: monospace; color: var(--oc-fg);' }, c.mac) ]),
					E('div', {}, [ E('span', { 'style': 'color: var(--oc-fg-3);' }, _('Phy Bitrate') + ': '), E('span', { 'style': 'color: var(--oc-fg); font-weight: 500;' }, 'Tx ' + txStr + ' / Rx ' + rxStr) ]),
					E('div', {}, [ E('span', { 'style': 'color: var(--oc-fg-3);' }, _('Connected Time') + ': '), E('span', { 'style': 'color: var(--oc-fg);' }, formatDuration(c.connected_sec || 0)) ]),
					E('div', {}, [ E('span', { 'style': 'color: var(--oc-fg-3);' }, _('Egress Node') + ': '), E('span', { 'style': 'color: #059669; font-weight: 600;' }, c.target || res.target || '-') ])
				])
			]);
		});

		var content = E('div', { 'style': 'width: 100%; max-height: 480px; overflow-y: auto; padding: 2px;' }, [
			E('div', { 'style': 'margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1px solid rgba(148, 163, 184, 0.15);' }, [
				E('span', { 'style': 'color: var(--oc-fg-2); font-size: 13px;' },
					_('Slot #%s (%s) · VLAN %s · Target: %s')
						.replace('%s', num)
						.replace('%s', ssid)
						.replace('%s', res.vlan || '-')
						.replace('%s', res.target || '-')
				),
				E('button', {
					'type': 'button',
					'class': 'cbi-button',
					'style': 'padding: 2px 8px; font-size: 12px;',
					'click': function() { window.openSlotClientsModal(sid, num, ssid); }
				}, '🔄 ' + _('Refresh'))
			]),
			E('div', {}, clientCards),
			E('div', { 'class': 'right', 'style': 'margin-top: 14px; display: flex; justify-content: flex-end;' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Close'))
			])
		]);

		ui.showModal(_('Slot #%s Clients Profile').replace('%s', num), content);
	}).catch(function(err) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, err.message), 'error');
	});
};

window.openApConfigModal = function() {
	var curHost = uci.get('omniclash', 'config', 'ap_host') || '192.168.100.2';
	var curToken = uci.get('omniclash', 'config', 'ap_token') || '';

	var modalContent = E('div', { 'style': 'width: 100%; box-sizing: border-box; padding: 4px 0;' }, [
		// 1. 顶部单行免中转安装指导框
		E('div', {
			'style': 'background: rgba(59, 130, 246, 0.08); border-left: 4px solid #3b82f6; padding: 10px 14px; border-radius: 4px; margin-bottom: 18px; font-size: 12px;'
		}, [
			E('div', { 'style': 'font-weight: 600; color: #2563eb; margin-bottom: 4px;' }, '⚡ ' + _('Install Agent on Child AP')),
			E('div', { 'style': 'color: var(--oc-fg-2); margin-bottom: 6px;' }, _('Run this command in the child AP terminal to install directly from this router:')),
			E('code', {
				'style': 'display: block; padding: 6px 10px; background: var(--oc-bg-3); border-radius: 4px; font-family: monospace; font-size: 11px; user-select: all; word-break: break-all; color: var(--oc-fg);'
			}, 'wget -qO /tmp/agent.ipk http://' + (window.location.hostname || '192.168.100.1') + '/omniclash-agent.ipk && opkg install /tmp/agent.ipk')
		]),

		// 2. 表单：上下堆叠式 (Stacked Layout)
		E('div', { 'style': 'margin-bottom: 14px;' }, [
			E('label', { 'style': 'display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: var(--oc-fg);' }, _('AP Host IP')),
			E('div', { 'style': 'display: flex; gap: 8px; align-items: center;' }, [
				E('input', {
					'type': 'text',
					'id': 'modal_ap_host',
					'class': 'cbi-input-text',
					'style': 'flex: 1; min-width: 0; box-sizing: border-box; font-family: monospace;',
					'value': curHost,
					'placeholder': '192.168.100.2'
				}),
				E('button', {
					'type': 'button',
					'id': 'modal_btn_discover',
					'class': 'cbi-button',
					'style': 'white-space: nowrap; padding: 0 12px; height: 34px; line-height: 34px; flex-shrink: 0;',
					'click': window.discoverChildAps
				}, '🔍 ' + _('Auto Scan AP'))
			]),
			E('div', { 'id': 'modal_discovered_devices' }),
			E('div', { 'style': 'margin-top: 4px; font-size: 12px; color: var(--oc-fg-2);' },
				_('IP address of the child AP on the local network (defaults to 192.168.100.2).'))
		]),

		E('div', { 'style': 'margin-bottom: 14px;' }, [
			E('label', { 'style': 'display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: var(--oc-fg);' }, _('Agent Token')),
			E('input', {
				'type': 'text',
				'id': 'modal_ap_token',
				'class': 'cbi-input-text',
				'style': 'width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px;',
				'value': curToken,
				'placeholder': _('Paste the token generated on the child AP')
			}),
			E('div', { 'style': 'margin-top: 4px; font-size: 12px; color: var(--oc-fg-2);' },
				_('Read it on the child AP with: cat /etc/omniclash-agent/token'))
		]),

		E('div', { 'style': 'margin-bottom: 16px; padding: 12px 14px; background: var(--oc-bg-2); border-radius: 6px; border: 1px solid rgba(148, 163, 184, 0.2);' }, [
			E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;' }, [
				E('label', { 'style': 'font-weight: 600; font-size: 13px; color: var(--oc-fg); margin: 0;' }, _('Channel Status')),
				E('button', {
					'type': 'button',
					'id': 'modal_btn_agent_probe',
					'class': 'cbi-button',
					'style': 'padding: 0 10px; font-size: 12px; margin: 0;',
					'click': window.refreshAgentStatus
				}, '🔌 ' + _('Test Connection'))
			]),
			E('div', { 'id': 'modal_agent_status', 'style': 'font-size: 13px; min-height: 20px; line-height: 1.5; color: var(--oc-fg-2);' }, _('Not probed yet'))
		]),

		// 3. 底部操作按钮栏
		E('div', { 'class': 'right', 'style': 'margin-top: 18px; display: flex; justify-content: flex-end; gap: 8px;' }, [
			E('button', {
				'type': 'button',
				'class': 'cbi-button',
				'click': ui.hideModal
			}, _('Cancel')),
			E('button', {
				'type': 'button',
				'class': 'cbi-button cbi-button-apply',
				'id': 'modal_btn_apply_network',
				'click': function() {
					var hostEl = document.getElementById('modal_ap_host');
					var tokenEl = document.getElementById('modal_ap_token');
					var hostVal = hostEl ? hostEl.value.trim() : '';
					var tokenVal = tokenEl ? tokenEl.value.trim() : '';

					callSaveApConfig(hostVal, tokenVal).then(function() {
						ui.hideModal();
						window.applyApNetwork();
					}).catch(function(err) {
						ui.addNotification(null, E('p', {}, err.message), 'error');
					});
				}
			}, '⚠️ ' + _('Apply Network on AP')),
			E('button', {
				'type': 'button',
				'class': 'cbi-button cbi-button-apply',
				'click': function() {
					var hostEl = document.getElementById('modal_ap_host');
					var tokenEl = document.getElementById('modal_ap_token');
					var hostVal = hostEl ? hostEl.value.trim() : '';
					var tokenVal = tokenEl ? tokenEl.value.trim() : '';

					callSaveApConfig(hostVal, tokenVal).then(function(res) {
						ensureRpcOk(res, _('Failed to save AP configuration'));
						try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
						ui.hideModal();
						ui.addNotification(null, E('p', {}, '✅ ' + _('AP configuration saved successfully!')), 'success');
						setTimeout(function() { window.location.reload(); }, 600);
					}).catch(function(err) {
						ui.hideModal();
						ui.addNotification(null, E('p', {}, err.message), 'error');
					});
				}
			}, _('Save'))
		])
	]);

	ui.showModal(_('Child AP Agent Settings'), modalContent);
};

return view.extend({
	load: function() {
		var cache = readMemoryCache();
		return Promise.all([
			uci.load('omniclash'),
			callGetStatus(),
			cache ? cache : fetchFreshData()
		]);
	},

	render: function(data) {
		var status = (data && data[1]) ? data[1] : {};
		var res = (data && data[2]) ? data[2] : {};
		var slots = (res && res.slots) ? res.slots : [];
		var limits = (res && res.limits) ? res.limits : { '2g': 16, '5g': 16 };

		var curRunMode = uci.get('omniclash', 'config', 'run_mode') || 'ap';
		var curWirelessMode = uci.get('omniclash', 'config', 'wireless_mode') || 'multi';
		var hasLocalWifi = !!status.has_local_wifi;
		if (!hasLocalWifi) {
			curRunMode = 'ap';
		}

		var isMulti = (curWirelessMode === 'multi');
		var isLocal = (curRunMode === 'local');

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
			if (s.num) usedNums[parseInt(s.num, 10)] = true;
		});

		var max5G = limits['5g'] || 16;
		var max2G = limits['2g'] || 16;
		var remaining5G = Math.max(0, max5G - count5G);
		var remaining2G = Math.max(0, max2G - count2G);
		var totalRemaining = remaining5G + remaining2G;

		window.switchMatrixSubTab = function(tabName) {
			var tabBtns = document.querySelectorAll('.matrix-subtab-btn');
			var tabPanes = document.querySelectorAll('.matrix-subtab-pane');

			tabBtns.forEach(function(b) {
				if (b.getAttribute('data-tab') === tabName) {
					b.style.borderBottom = '2px solid #3b82f6';
					b.style.color = '#3b82f6';
					b.style.fontWeight = 'bold';
				} else {
					b.style.borderBottom = '2px solid transparent';
					b.style.color = '';
					b.style.fontWeight = 'normal';
				}
			});

			tabPanes.forEach(function(p) {
				p.style.display = (p.id === 'pane_' + tabName) ? 'block' : 'none';
			});
		};

		// 强制手动穿透刷新
		window.forceRefreshMatrix = function() {
			try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
			var btn = document.getElementById('omni_refresh_btn');
			if (btn) { btn.innerText = _('Bypassing cache...'); btn.disabled = true; }
			fetchFreshData().then(function() {
				ui.addNotification(null, E('p', {}, '✅ ' + _('Cache bypassed and refreshed! Synchronized latest AP and router status.')), 'success');
				setTimeout(function() { window.location.reload(); }, 300);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
				if (btn) { btn.innerText = '🔄 ' + _('Refresh (Bypass Cache)'); btn.disabled = false; }
			});
		};

		// 保存单个多 WiFi 槽位
		window.saveSlotWifiOnly = function(sid, num) {
			var ssid = document.getElementById('native_ssid_' + num).value.trim();
			var key = document.getElementById('native_key_' + num).value.trim();

			if (!ssid || key.length < 8) {
				ui.addNotification(null, E('p', {}, _('SSID cannot be empty and password must be at least 8 characters!')), 'error');
				return;
			}

			ui.showModal(_('Saving'), [ E('p', { 'class': 'spinning' }, _('Synchronizing WiFi #%s and smoothly reloading wireless...').replace('%s', num)) ]);
			var payload = { sid: sid, ssid: ssid, key: key };

			callSaveSlotRpc(payload).then(function(res) {
				ensureRpcOk(res, _('Failed to save WiFi slot'));
				var currentSlot = slots.find(function(s) { return s.sid === sid; });
				if (currentSlot) { currentSlot.ssid = ssid; currentSlot.key = key; }
				writeMemoryCache(res);
				ui.hideModal();
				ui.addNotification(null, E('p', {}, '✅ ' + _('WiFi #%s (%s) SSID and password synchronized successfully!').replace('%s', num).replace('%s', ssid)), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		// 保存普通标准 WiFi
		window.saveNormalWifiItem = function(id) {
			var ssid = document.getElementById('normal_ssid_' + id).value.trim();
			var key = document.getElementById('normal_key_' + id).value.trim();

			if (!ssid || key.length < 8) {
				ui.addNotification(null, E('p', {}, _('SSID cannot be empty and password must be at least 8 characters!')), 'error');
				return;
			}

			var currentItem = slots.find(function(s) { return s.id === id; });
			if (currentItem) {
				currentItem.ssid = ssid;
				currentItem.key = key;
			}

			ui.showModal(_('Saving'), [ E('p', { 'class': 'spinning' }, _('Saving standard WiFi settings and smoothly reloading wireless...')) ]);
			callSaveWifiNormalRpc(slots).then(function(res) {
				ensureRpcOk(res, _('Failed to save standard WiFi settings'));
				try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
				ui.hideModal();
				ui.addNotification(null, E('p', {}, '✅ ' + _('Standard WiFi settings saved and applied successfully!')), 'success');
				setTimeout(function() { window.location.reload(); }, 600);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		// 毫秒级软开关切换广播
		window.toggleSlotWifi = function(sid, num, targetDisabled) {
			var actionText = targetDisabled ? _('Disable') : _('Enable');
			ui.showModal(_('Switching'), [ E('p', { 'class': 'spinning' }, _('Switching WiFi #%s to %s...').replace('%s', num).replace('%s', actionText)) ]);

			callToggleWifiRpc(sid, targetDisabled).then(function(res) {
				ensureRpcOk(res, _('Failed to switch WiFi broadcast status'));
				try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
				ui.hideModal();
				ui.addNotification(null, E('p', {}, '✅ ' + _('WiFi #%s %s successfully!').replace('%s', num).replace('%s', actionText)), 'success');
				setTimeout(function() { window.location.reload(); }, 600);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		// 切换普通 WiFi 广播
		window.toggleNormalWifi = function(id, targetDisabled) {
			var currentItem = slots.find(function(s) { return s.id === id; });
			if (currentItem) currentItem.disabled = targetDisabled;

			ui.showModal(_('Switching'), [ E('p', { 'class': 'spinning' }, _('Toggling wireless broadcast...')) ]);
			callSaveWifiNormalRpc(slots).then(function(res) {
				ensureRpcOk(res, _('Failed to update WiFi broadcast status'));
				try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
				ui.hideModal();
				ui.addNotification(null, E('p', {}, '✅ ' + _('Wireless broadcast status updated!')), 'success');
				setTimeout(function() { window.location.reload(); }, 600);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		// 【一键加满】预览模态弹窗与执行
		window.openFillAllModal = function() {
			if (totalRemaining <= 0) {
				ui.addNotification(null, E('p', {}, _('Hardware capacity is already full (5G 16/16, 2.4G 16/16)!')), 'info');
				return;
			}

			var planList = [];
			var curUsed = Object.assign({}, usedNums);

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
					mode: _('General Routing (Default Fallback)')
				});
			}

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
					mode: _('General Routing (Default Fallback)')
				});
			}

			var modalContent = E('div', { 'style': 'text-align: left; padding: 4px 0;' }, [
				E('div', { 'style': 'background: rgba(59, 130, 246, 0.1); border-left: 4px solid #3b82f6; padding: 10px 14px; border-radius: 4px; margin-bottom: 16px;' }, [
					E('b', { 'style': 'color: #60a5fa; font-size: 14px;' }, '⚡ ' + _('Fill All Remaining WiFi (%d slots)').replace('%d', totalRemaining)),
					E('p', { 'style': 'color: var(--oc-fg-3); margin: 4px 0 0 0; font-size: 12px; line-height: 1.5;' },
						_('System will automatically link AP radios, dedicated VLANs, DHCP pools, and routing rules to fill all empty slots.')
					)
				]),
				E('div', { 'style': 'max-height: 320px; overflow-y: auto; border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 6px; margin-bottom: 20px;' }, [
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse; margin: 0; font-size: 12px;' }, [
						E('thead', {}, [
							E('tr', { 'style': 'background: var(--oc-bg-3);' }, [
								E('th', { 'style': 'width: 50px; text-align: center;' }, _('Slot')),
								E('th', { 'style': 'width: 75px; text-align: center;' }, _('Band')),
								E('th', {}, _('Default SSID')),
								E('th', { 'style': 'width: 85px;' }, _('Default Key')),
								E('th', { 'style': 'width: 140px; text-align: center;' }, _('Assigned VLAN')),
								E('th', { 'style': 'width: 110px;' }, _('Routing Target'))
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
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')),
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': function() {
							ui.showModal(_('Filling All Slots'), [ E('p', { 'class': 'spinning' }, _('Initializing VLANs, DHCP, AP radios, and routing rules, please wait 5~8 seconds...')) ]);
							fs.exec('/usr/bin/omniclash', ['init_all_32']).then(function() {
								try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
								ui.hideModal();
								ui.addNotification(null, E('p', {}, '🎉 ' + _('Successfully filled full WiFi matrix!')), 'success');
								setTimeout(function() { window.location.reload(); }, 1200);
							}).catch(function(err) {
								ui.hideModal();
								ui.addNotification(null, E('p', {}, err.message), 'error');
							});
						}
					}, _('Confirm Fill All (%d slots)').replace('%d', totalRemaining))
				])
			]);

			ui.showModal(_('Fill All Remaining WiFi Slots'), modalContent);
		};

		var cacheStatusBadge = '';
		if (res._isFromCache && res._cacheTime) {
			var passedSecs = Math.floor((Date.now() - res._cacheTime) / 1000);
			var passedStr = passedSecs < 60 ? _('%d seconds ago').replace('%d', passedSecs) : _('%d minutes ago').replace('%d', Math.floor(passedSecs / 60));
			cacheStatusBadge = ' (' + '⚡ ' + _('Fast cache hit, updated %s').replace('%s', passedStr) + ')';
		}

		// 1. 构建 Tab 1: 模式与架构设置 (Mode Settings)
		var paneSettings = E('div', { 'id': 'pane_settings', 'class': 'matrix-subtab-pane', 'style': 'display: block;' }, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Wireless Topology & Operating Mode')),

				E('div', { 'class': 'cbi-value', 'style': 'display: flex; align-items: center; margin-bottom: 14px;' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Operating Mode')),
					E('div', { 'class': 'cbi-value-field', 'style': 'display: flex; align-items: center; gap: 12px; flex-wrap: wrap;' }, [
						hasLocalWifi ?
							E('span', { 'style': 'display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: #059669;' }, [
								E('span', { 'style': 'width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;' }),
								_('Local Host Mode (Physical Wi-Fi detected)')
							]) :
							E('span', { 'style': 'display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: #2563eb;' }, [
								E('span', { 'style': 'width: 8px; height: 8px; border-radius: 50%; background: #3b82f6; display: inline-block;' }),
								_('Remote Child AP Mode (Auto-coordinated with child AP)')
							]),
						(!hasLocalWifi) ? E('button', {
							'type': 'button',
							'class': 'cbi-button cbi-button-action',
							'click': window.openApConfigModal
						}, '⚙️ ' + _('Configure Child AP')) : '',
						E('div', { 'class': 'cbi-value-description', 'style': 'width: 100%; margin-top: 4px;' },
							hasLocalWifi ?
								_('Physical Wi-Fi hardware detected on this host. Managing local wireless radios directly.') :
								_('No physical Wi-Fi hardware on this host. Operating in coordinated Child AP mode via omniclash-agent.'))
					])
				]),

				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Wireless Running Mode')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('select', {
							'id': 'tab_wireless_mode',
							'class': 'cbi-input-select',
							'style': 'width: 320px;'
						}, [
							E('option', { 'value': 'multi', 'selected': curWirelessMode === 'multi' ? 'selected' : null }, _('Multi-WiFi Matrix Mode (32 Dedicated Slots, Recommended)')),
							E('option', { 'value': 'normal', 'selected': curWirelessMode === 'normal' ? 'selected' : null }, _('Standard Normal WiFi Mode (Dual-Band 2.4G/5G)'))
						]),
						E('div', { 'class': 'cbi-value-description' }, _('Switch between 32-slot matrix and standard dual-band WiFi. Configurations are stored separately.'))
					])
				]),

				E('div', { 'style': 'padding-top: 14px; border-top: 1px solid rgba(148, 163, 184, 0.15); display: flex; justify-content: flex-end;' }, [
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-apply',
						'click': function() {
							var newWirelessMode = document.getElementById('tab_wireless_mode').value;
							ui.showModal(_('Saving & Applying'), [ E('p', { 'class': 'spinning' }, _('Saving operating modes and reloading configuration...')) ]);
							uci.set('omniclash', 'config', 'run_mode', hasLocalWifi ? 'local' : 'ap');
							uci.set('omniclash', 'config', 'wireless_mode', newWirelessMode);
							callSaveWirelessMode(newWirelessMode, hasLocalWifi ? 'local' : 'ap').then(function(res) {
								ensureRpcOk(res, _('Failed to save wireless mode'));
							}).then(function() {
								try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
								ui.hideModal();
								ui.addNotification(null, E('p', {}, '✅ ' + _('Mode settings saved and applied successfully!')), 'success');
								setTimeout(function() { window.location.reload(); }, 600);
							}).catch(function(err) {
								ui.hideModal();
								ui.addNotification(null, E('p', {}, err.message), 'error');
							});
						}
					}, _('Save Mode Settings'))
				])
			])
		]);

		// 2. 构建 Tab 2: WiFi 设置 (动态呈现多 WiFi 或标准普通 WiFi)
		var paneWifi = null;
		if (isMulti) {
			// 多 WiFi 32 槽位视图
			var MODE_OPTS = [
				{ value: 'global', label: '🔒 ' + _('Global (all traffic via exit)') },
				{ value: 'split', label: '🎯 ' + _('Targeted (CN direct, rest via exit)') },
				{ value: 'app_pool', label: '🔀 ' + _('General (app cards decide)') }
			];
			var exitOptions = (res.candidates || []).slice();

			var multiRows = slots.map(function(slot) {
				var isOff = !!slot.disabled;
				var modeSel = ocui.select(MODE_OPTS, slot.mode || 'split');
				var exits = exitOptions.slice();
				if (slot.target && exits.indexOf(slot.target) < 0) exits.unshift(slot.target);
				var exitSel = ocui.select(exits, slot.target);
				var saveRoute = ocui.btn(_('Apply'), function() {
					var btn = this;
					btn.disabled = true;
					callSaveSlotRoute(slot.sid, modeSel.value, exitSel.value).then(function(r) {
						ocui.ensureOk(r, _('Failed to update slot routing'));
						slot.mode = modeSel.value;
						slot.target = exitSel.value;
						try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
						ui.addNotification(null, E('p', {}, '✅ ' + _('Slot #%s routing updated').replace('%s', slot.num)), 'success');
					}).catch(function(err) {
						modeSel.value = slot.mode;
						exitSel.value = slot.target;
						ui.addNotification(null, E('p', {}, err.message), 'error');
					}).finally(function() {
						btn.disabled = false;
						saveRoute.style.visibility = 'hidden';
					});
				}, 'apply', { 'style': 'visibility:hidden' });
				var showApply = function() {
					saveRoute.style.visibility = (modeSel.value !== slot.mode || exitSel.value !== slot.target) ? '' : 'hidden';
				};
				modeSel.addEventListener('change', showApply);
				exitSel.addEventListener('change', showApply);

				var clients = isOff ? E('span', { 'class': 'oc-desc' }, '—')
					: (slot.clients > 0) ? ocui.btn('📱 ' + slot.clients, function() { window.openSlotClientsModal(slot.sid, slot.num, slot.ssid); }, null, { 'title': _('Click to view connected client details') })
					: E('span', { 'class': 'oc-desc' }, '0');

				return E('tr', { 'class': isOff ? 'is-off' : '' }, [
					E('td', {}, E('b', { 'class': 'oc-mono' }, '#' + slot.num)),
					E('td', {}, ocui.tag(slot.band.toUpperCase(), slot.band === '5g' ? 'vio' : 'pri', true)),
					E('td', { 'style': 'min-width:150px' }, E('input', { 'type': 'text', 'id': 'native_ssid_' + slot.num, 'class': 'cbi-input-text', 'value': slot.ssid })),
					E('td', { 'style': 'min-width:120px' }, E('input', { 'type': 'text', 'id': 'native_key_' + slot.num, 'class': 'cbi-input-text oc-mono', 'value': slot.key })),
					E('td', {}, ocui.tag('VLAN ' + (slot.vlan || (100 + parseInt(slot.num, 10))), null, true)),
					E('td', { 'style': 'min-width:170px' }, modeSel),
					E('td', { 'style': 'min-width:150px' }, E('div', { 'style': 'display:flex;gap:6px;align-items:center' }, [ exitSel, saveRoute ])),
					E('td', {}, ocui.tag(isOff ? _('Disabled') : _('Broadcasting'), isOff ? null : 'ok')),
					E('td', {}, clients),
					E('td', { 'style': 'white-space:nowrap' }, [
						ocui.btn(_('Save'), function() { saveSlotWifiOnly(slot.sid, slot.num); }, 'apply'), ' ',
						ocui.btn(isOff ? _('Enable') : _('Disable'), function() { toggleSlotWifi(slot.sid, slot.num, !isOff); }, isOff ? 'action' : 'neutral')
					])
				]);
			});

			var multiSubtitle = (isLocal ? _('Operating Mode: Local Host Matrix') : (_('Operating Mode: Child AP Matrix (%s)').replace('%s', res.ap_host || '192.168.100.2'))) +
				' | ' + _('AP Physical Capacity') + ': 5G ' + count5G + '/' + max5G + ' (' + _('Broadcasting') + ' ' + active5G + ') | 2.4G ' + count2G + '/' + max2G + ' (' + _('Broadcasting') + ' ' + active2G + ')' +
				(totalRemaining > 0 ? (' | ⚡ ' + _('Fillable: %d slots').replace('%d', totalRemaining)) : (' | 🎉 ' + _('All slots ready')));

			paneWifi = E('div', { 'id': 'pane_wifi', 'class': 'matrix-subtab-pane', 'style': 'display: none;' }, [
				E('div', { 'style': 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding: 4px 0 12px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.15);' }, [
					E('div', {}, [
						E('h2', { 'style': 'margin: 0 0 6px 0; font-size: 16px;' }, [
							_('OmniClash Wireless AP Matrix'),
							E('span', { 'style': 'font-size: 12px; font-weight: normal; color: #10b981; margin-left: 10px;' }, cacheStatusBadge)
						]),
						E('div', { 'style': 'font-size: 13px; color: var(--oc-fg-3);' }, multiSubtitle)
					]),
					E('div', { 'style': 'display: flex; gap: 8px; align-items: center;' }, [
						(totalRemaining > 0) ? E('button', {
							'class': 'cbi-button cbi-button-add',
							'style': 'font-weight: bold; background: #2563eb;',
							'click': window.openFillAllModal
						}, '⚡ ' + _('Fill All (%d slots)').replace('%d', totalRemaining)) : '',
						E('button', {
							'id': 'omni_refresh_btn',
							'class': 'cbi-button cbi-button-action',
							'click': window.forceRefreshMatrix
						}, '🔄 ' + _('Refresh (Bypass Cache)')),
						(curRunMode === 'ap') ? E('button', {
							'id': 'omni_sync_matrix_btn',
							'class': 'cbi-button cbi-button-apply',
							'click': window.syncMatrixToAp
						}, '📤 ' + _('Push to Child AP')) : '',
						E('button', {
							'class': 'cbi-button cbi-button-reset',
							'click': function() {
								if (!confirm(_('Are you sure you want to reset all 32-WiFi slots to defaults?'))) return;
								ui.showModal(_('Resetting'), [ E('p', { 'class': 'spinning' }, _('Resetting 32-WiFi matrix to defaults...')) ]);
								callResetMatrix32Rpc().then(function(res) {
									ensureRpcOk(res, _('Failed to reset 32-WiFi matrix'));
									try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
									ui.hideModal();
									ui.addNotification(null, E('p', {}, '✅ ' + _('32-WiFi matrix reset to defaults successfully!')), 'success');
									setTimeout(function() { window.location.reload(); }, 800);
								}).catch(function(err) {
									ui.hideModal();
									ui.addNotification(null, E('p', {}, err.message), 'error');
								});							}
						}, '🔄 ' + _('Reset to Default Matrix'))
					])
				]),
				ocui.note([ E('b', {}, _('Routing per slot: ')), _('Global = every connection uses the slot exit, CN included. Targeted = CN direct, everything else via the slot exit. General = application cards decide, the slot exit is only the final fallback. Changes apply instantly with a hot reload.') ]),
				E('div', { 'class': 'oc-table-wrap' }, E('table', { 'class': 'oc-table' }, [
					E('thead', {}, E('tr', {}, [
						E('th', {}, _('Slot')), E('th', {}, _('Band')), E('th', {}, _('WiFi Name (SSID)')), E('th', {}, _('WiFi Password')),
						E('th', {}, _('VLAN')), E('th', {}, _('Routing Mode')), E('th', {}, _('Exit')),
						E('th', {}, _('Status')), E('th', {}, _('Clients')), E('th', {}, _('Actions'))
					])),
					E('tbody', {}, multiRows.length ? multiRows : [ E('tr', {}, E('td', { 'colspan': '10' }, ocui.empty(_('Loading 32-slot AP matrix...')))) ])
				]))
			]);
		} else {
			// 标准普通双频 WiFi 视图
			var normalRows = slots.map(function(item) {
				var isOff = !!item.disabled;
				var id = item.id || ('wifi_' + item.band);

				return E('tr', { 'style': isOff ? 'opacity: 0.6; background: var(--oc-bg-3);' : '' }, [
					E('td', { 'style': 'width: 80px; text-align: center; vertical-align: middle;' }, [
						E('span', { 'class': 'badge', 'style': 'padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; color: ' + (item.band === '5g' ? '#7c3aed' : '#0891b2') + '; background: ' + (item.band === '5g' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(6, 182, 212, 0.15)') }, item.band.toUpperCase())
					]),
					E('td', { 'style': 'width: 220px;' }, [
						E('input', { 'type': 'text', 'id': 'normal_ssid_' + id, 'class': 'cbi-input-text', 'style': 'width: 100%; font-weight: 500;', 'value': item.ssid || '' })
					]),
					E('td', { 'style': 'width: 180px;' }, [
						E('input', { 'type': 'text', 'id': 'normal_key_' + id, 'class': 'cbi-input-text', 'style': 'width: 100%; font-family: monospace;', 'value': item.key || '' })
					]),
					E('td', { 'style': 'text-align: center; width: 100px; vertical-align: middle;' }, [
						E('span', {
							'class': 'badge',
							'style': 'padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; background: ' + (isOff ? 'var(--oc-fg-3)' : '#10b981')
						}, isOff ? _('Disabled') : _('Broadcasting'))
					]),
						E('td', { 'style': 'text-align: center; width: 80px; vertical-align: middle;' }, [
							(isOff) ? E('span', { 'style': 'color: var(--oc-fg-3);' }, '-') :
							(item.clients > 0) ? E('button', {
								'type': 'button',
								'class': 'cbi-button',
								'style': 'padding: 2px 8px; font-size: 12px; font-weight: bold; color: #059669; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.1); cursor: pointer; border-radius: 4px;',
								'title': _('Click to view connected client details'),
								'click': (function(sid, num, ssid) {
									return function() { window.openSlotClientsModal(sid, num, ssid); };
								})(id, item.band.toUpperCase(), item.ssid)
							}, '📱 ' + item.clients) :
							E('span', { 'style': 'color: var(--oc-fg-3); font-size: 13px;' }, '0')
						]),
					E('td', { 'style': 'width: 160px; white-space: nowrap; text-align: center; vertical-align: middle;' }, [
						E('button', {
							'class': 'cbi-button cbi-button-apply',
							'style': 'margin-right: 6px;',
							'click': function() { saveNormalWifiItem(id); }
						}, _('Save')),
						E('button', {
							'class': isOff ? 'cbi-button cbi-button-action' : 'cbi-button cbi-button-neutral',
							'click': function() { toggleNormalWifi(id, !isOff); }
						}, isOff ? _('Enable') : _('Disable'))
					])
				]);
			});

			paneWifi = E('div', { 'id': 'pane_wifi', 'class': 'matrix-subtab-pane', 'style': 'display: none;' }, [
				E('div', { 'style': 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding: 4px 0 12px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.15);' }, [
					E('div', {}, [
						E('h2', { 'style': 'margin: 0 0 6px 0; font-size: 16px;' }, [
							_('OmniClash Standard WiFi Settings'),
							E('span', { 'style': 'font-size: 12px; font-weight: normal; color: #10b981; margin-left: 10px;' }, cacheStatusBadge)
						]),
						E('div', { 'style': 'font-size: 13px; color: var(--oc-fg-3);' },
							_('Standard Dual-Band WiFi (5G / 2.4G) | Stored in /etc/omniclash/wifi_normal.json')
						)
					]),
					E('div', { 'style': 'display: flex; gap: 8px; align-items: center;' }, [
						E('button', {
							'id': 'omni_refresh_btn',
							'class': 'cbi-button cbi-button-action',
							'click': window.forceRefreshMatrix
						}, '🔄 ' + _('Refresh (Bypass Cache)')),
						E('button', {
							'class': 'cbi-button cbi-button-reset',
							'click': function() {
								if (!confirm(_('Are you sure you want to reset standard WiFi to defaults?'))) return;
								ui.showModal(_('Resetting'), [ E('p', { 'class': 'spinning' }, _('Resetting standard WiFi to defaults...')) ]);
								callResetWifiNormalRpc().then(function(res) {
									ensureRpcOk(res, _('Failed to reset standard WiFi'));
									try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
									ui.hideModal();
									ui.addNotification(null, E('p', {}, '✅ ' + _('Standard WiFi reset to defaults successfully!')), 'success');
									setTimeout(function() { window.location.reload(); }, 600);
								}).catch(function(err) {
									ui.hideModal();
									ui.addNotification(null, E('p', {}, err.message), 'error');
								});
							}
						}, '🔄 ' + _('Reset to Default Normal WiFi'))
					])
				]),
				E('div', { 'class': 'cbi-section' }, [
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse;' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'style': 'width: 80px; text-align: center;' }, _('Band')),
								E('th', { 'style': 'width: 220px;' }, _('WiFi Name (SSID)')),
								E('th', { 'style': 'width: 180px;' }, _('WiFi Password')),
								E('th', { 'style': 'text-align: center; width: 100px;' }, _('Broadcast Status')),
								E('th', { 'style': 'text-align: center; width: 80px;' }, _('Online Clients')),
								E('th', { 'style': 'width: 160px; text-align: center;' }, _('Actions'))
							])
						]),
						E('tbody', {}, normalRows.length ? normalRows : [ E('tr', {}, [ E('td', { 'colspan': '6', 'style': 'text-align: center; padding: 24px; color: var(--oc-fg-3);' }, _('No standard WiFi interfaces found.')) ]) ])
					])
				])
			]);
		}

		// 3. 构建 Tab 3: 场景复刻与一键初始化向导 (AP Provisioning)
		var paneProvision = E('div', { 'id': 'pane_provision', 'class': 'matrix-subtab-pane', 'style': 'display: none;' }, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('One-Click AP Provisioning & Cloning')),
				E('p', { 'style': 'color: var(--oc-fg-3); margin-bottom: 16px; font-size: 13px; line-height: 1.6;' },
					_('Deploy full 32-WiFi architecture to newly flashed child AP with a single click. Ideal for reproducing this setup on new routers or fresh setups.')
				),

				E('div', { 'style': 'background: rgba(59, 130, 246, 0.05); border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 4px; margin-bottom: 20px;' }, [
					E('h4', { 'style': 'margin: 0 0 8px 0; color: #2563eb;' }, _('Automated Deployment Steps')),
					E('ul', { 'style': 'margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8;' }, [
						E('li', {}, _('Child AP: Automatically create 32 802.1Q VLAN bridges (br-vlan101 ~ br-vlan132 on br-lan.101~132)')),
						E('li', {}, _('Main Router: Automatically configure 32 independent static VLAN subnets (192.168.101.1/24 ~ 132.1/24) and DHCP pools')),
						E('li', {}, _('Radios: Bind 5G and 2.4G physical radios to 32 BSSID slots (16 5G + 16 2.4G) with 1:1 symmetry')),
						E('li', {}, _('Firewall: Inject input/forward accept chains into fw4 and bind Mihomo 6-tier routing pipeline'))
					])
				]),

				E('div', { 'style': 'padding: 12px 0;' }, [
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-action',
						'style': 'padding: 8px 20px; font-size: 14px; font-weight: bold;',
						'click': function() {
							if (!confirm(_('Are you sure you want to deploy full 32-WiFi architecture to the child AP?\nThis will configure all VLAN bridges, subnets, DHCP pools, and reload wireless interfaces.'))) return;
							ui.showModal(_('Deploying 32-WiFi Architecture'), [
								E('p', { 'class': 'spinning' }, _('Initializing VLANs, DHCP, AP radios, and routing rules, please wait 5~8 seconds...'))
							]);
							fs.exec('/usr/bin/omniclash', ['init_all_32']).then(function() {
								try { if (window.localStorage) window.localStorage.removeItem(CACHE_KEY); } catch(e) {}
								ui.hideModal();
								ui.addNotification(null, E('p', {}, '🎉 ' + _('32-WiFi architecture deployed to child AP successfully!')), 'success');
								setTimeout(function() { window.location.reload(); }, 1200);
							}).catch(function(err) {
								ui.hideModal();
								ui.addNotification(null, E('p', {}, err.message), 'error');
							});
						}
					}, '⚡ ' + _('Deploy Full 32-WiFi Architecture to AP'))
				])
			])
		]);

		ocui.init();
		[ paneSettings, paneWifi, paneProvision ].forEach(function(p) { if (p) { p.removeAttribute('style'); p.className = ''; } });
		return ocui.root([ E('h2', {}, _('OmniClash Wireless AP Management Hub')) ].concat(ocui.tabs('omniclash.matrix.tab', [
			{ id: 'wifi', label: '📶 ' + _('WiFi Settings'), content: paneWifi },
			{ id: 'settings', label: '⚙️ ' + _('Mode Settings'), content: paneSettings },
			{ id: 'provision', label: '⚡ ' + _('AP Provisioning & Clone'), content: paneProvision }
		])));
	}
});
