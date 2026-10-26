'use strict';
'require view';
'require rpc';
'require uci';
'require fs';
'require dom';
'require ui';

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

var callTestAp = rpc.declare({
	object: 'luci.omniclash',
	method: 'test_ap',
	params: [ 'host', 'port', 'user', 'password' ]
});

var callAgentStatus = rpc.declare({
	object: 'luci.omniclash',
	method: 'agent_status'
});

var callSyncMatrix = rpc.declare({
	object: 'luci.omniclash',
	method: 'sync_matrix'
});

var callApplyApNetwork = rpc.declare({
	object: 'luci.omniclash',
	method: 'apply_ap_network'
});

var callPairAp = rpc.declare({
	object: 'luci.omniclash',
	method: 'pair_ap',
	params: [ 'host', 'port', 'user', 'password' ]
});

var CACHE_KEY = 'omniclash_matrix_cache_v3';
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

	ui.showModal(_('Syncing to Child AP'), [ E('p', { 'class': 'spinning' }, _('Upserting wireless interfaces on the child AP...')) ]);

	callSyncMatrix().then(function(res) {
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
	if (btn) btn.disabled = true;
	if (fb) dom.content(fb, E('span', { 'class': 'spinning' }, _('Probing control channel...')));

	/* 探测前先把弹窗里的值落到 uci，否则探测用的还是上一次保存的地址/令牌 */
	var host = document.getElementById('modal_ap_host');
	var token = document.getElementById('modal_ap_token');
	var transport = document.getElementById('modal_ap_transport');
	if (host && host.value.trim()) uci.set('omniclash', 'config', 'ap_host', host.value.trim());
	if (token && token.value.trim()) uci.set('omniclash', 'config', 'ap_token', token.value.trim());
	if (transport) uci.set('omniclash', 'config', 'ap_transport', transport.value);

	uci.save().then(function() {
		return uci.apply();
	}).then(function() {
		return callAgentStatus();
	}).then(function(res) {
		if (btn) btn.disabled = false;
		var ok = res && res.available;
		if (!fb) return;
		var color = ok ? '#059669' : '#dc2626';
		var text = ok
			? ('🟢 ' + _('Agent channel ready (v%s, %d ms)').replace('%s', res.version || '?').replace('%d', res.latency_ms || 0))
			: ('🔴 ' + _('Agent unavailable: %s').replace('%s', res && res.error ? res.error : _('no response')));
		dom.content(fb, E('span', { 'style': 'color: ' + color + '; font-weight: 500;' }, text));
	}).catch(function(err) {
		if (btn) btn.disabled = false;
		if (fb) dom.content(fb, E('span', { 'style': 'color: #dc2626; font-weight: 500;' }, '🔴 ' + err.message));
	});
};

window.openApConfigModal = function() {	var curHost = uci.get('omniclash', 'config', 'ap_host') || '192.168.100.2';
	var curPort = uci.get('omniclash', 'config', 'ap_port') || '22';
	var curUser = uci.get('omniclash', 'config', 'ap_user') || 'root';
	var curPass = uci.get('omniclash', 'config', 'ap_password') || '';
	var curToken = uci.get('omniclash', 'config', 'ap_token') || '';
	var curTransport = uci.get('omniclash', 'config', 'ap_transport') || 'auto';

	var modalContent = E('div', { 'class': 'cbi-map', 'style': 'margin: 0; padding: 6px 0;' }, [
		E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-value', 'style': 'display: flex; align-items: center; margin-bottom: 14px; gap: 12px;' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'width: 140px; min-width: 140px; text-align: right; padding-right: 12px; margin: 0; font-weight: 500; font-size: 13px;' }, _('AP Host IP')),
				E('div', { 'class': 'cbi-value-field', 'style': 'flex: 1; padding: 0;' }, [
					E('input', {
						'type': 'text',
						'id': 'modal_ap_host',
						'class': 'cbi-input-text',
						'style': 'width: 100%; max-width: 320px; font-family: monospace;',
						'value': curHost,
						'placeholder': '192.168.100.2'
					})
				])
			]),
			E('div', { 'class': 'cbi-value', 'style': 'display: flex; align-items: center; margin-bottom: 14px; gap: 12px;' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'width: 140px; min-width: 140px; text-align: right; padding-right: 12px; margin: 0; font-weight: 500; font-size: 13px;' }, _('SSH Port')),
				E('div', { 'class': 'cbi-value-field', 'style': 'flex: 1; padding: 0;' }, [
					E('input', {
						'type': 'text',
						'id': 'modal_ap_port',
						'class': 'cbi-input-text',
						'style': 'width: 100%; max-width: 320px; font-family: monospace;',
						'value': curPort,
						'placeholder': '22'
					})
				])
			]),
			E('div', { 'class': 'cbi-value', 'style': 'display: flex; align-items: center; margin-bottom: 14px; gap: 12px;' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'width: 140px; min-width: 140px; text-align: right; padding-right: 12px; margin: 0; font-weight: 500; font-size: 13px;' }, _('SSH User')),
				E('div', { 'class': 'cbi-value-field', 'style': 'flex: 1; padding: 0;' }, [
					E('input', {
						'type': 'text',
						'id': 'modal_ap_user',
						'class': 'cbi-input-text',
						'style': 'width: 100%; max-width: 320px; font-family: monospace;',
						'value': curUser,
						'placeholder': 'root'
					})
				])
			]),
			E('div', { 'class': 'cbi-value', 'style': 'display: flex; align-items: flex-start; margin-bottom: 14px; gap: 12px;' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'width: 140px; min-width: 140px; text-align: right; padding-right: 12px; margin: 0; font-weight: 500; font-size: 13px; padding-top: 6px;' }, _('SSH Password')),
				E('div', { 'class': 'cbi-value-field', 'style': 'flex: 1; padding: 0;' }, [
					E('input', {
						'type': 'password',
						'id': 'modal_ap_password',
						'class': 'cbi-input-text',
						'style': 'width: 100%; max-width: 320px; font-family: monospace;',
						'value': curPass,
						'placeholder': _('Optional if key trust established')
					}),
					E('div', { 'class': 'cbi-value-description', 'style': 'margin-top: 4px; font-size: 12px; color: #64748b;' }, _('Child AP SSH login password (used for initial pairing; optional after key trust is established).'))
				])
			]),
			E('div', { 'class': 'cbi-value', 'style': 'display: flex; align-items: flex-start; margin-bottom: 8px; gap: 12px;' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'width: 140px; min-width: 140px; text-align: right; padding-right: 12px; margin: 0; font-weight: 500; font-size: 13px; padding-top: 6px;' }, _('Control Channel')),
				E('div', { 'class': 'cbi-value-field', 'style': 'flex: 1; padding: 0;' }, [
					E('select', {
						'id': 'modal_ap_transport',
						'class': 'cbi-input-select',
						'style': 'width: 100%; max-width: 320px;',
						'change': function() { window.refreshAgentStatus(); }
					}, [
						E('option', { 'value': 'auto', 'selected': curTransport === 'auto' ? 'selected' : null }, _('Auto (Agent preferred, SSH fallback)')),
						E('option', { 'value': 'agent', 'selected': curTransport === 'agent' ? 'selected' : null }, _('Agent only')),
						E('option', { 'value': 'ssh', 'selected': curTransport === 'ssh' ? 'selected' : null }, _('SSH only (legacy)'))
					]),
					E('div', { 'class': 'cbi-value-description', 'style': 'margin-top: 4px; font-size: 12px; color: #64748b;' },
						_('The Agent channel is a structured HTTP endpoint on the child AP and needs no SSH password. SSH is kept as a compatibility fallback.'))
				])
			]),
			E('div', { 'class': 'cbi-value', 'style': 'display: flex; align-items: flex-start; margin-bottom: 8px; gap: 12px;' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'width: 140px; min-width: 140px; text-align: right; padding-right: 12px; margin: 0; font-weight: 500; font-size: 13px; padding-top: 6px;' }, _('Agent Token')),
				E('div', { 'class': 'cbi-value-field', 'style': 'flex: 1; padding: 0;' }, [
					E('input', {
						'type': 'text',
						'id': 'modal_ap_token',
						'class': 'cbi-input-text',
						'style': 'width: 100%; max-width: 320px; font-family: monospace; font-size: 12px;',
						'value': curToken,
						'placeholder': _('Paste the token generated on the child AP')
					}),
					E('div', { 'class': 'cbi-value-description', 'style': 'margin-top: 4px; font-size: 12px; color: #64748b;' },
						_('Read it on the child AP with: cat /etc/omniclash-agent/token'))
				])
			]),
			E('div', { 'class': 'cbi-value', 'style': 'display: flex; align-items: flex-start; margin-bottom: 8px; gap: 12px;' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'width: 140px; min-width: 140px; text-align: right; padding-right: 12px; margin: 0; font-weight: 500; font-size: 13px; padding-top: 4px;' }, _('Channel Status')),
				E('div', { 'class': 'cbi-value-field', 'style': 'flex: 1; padding: 0;' }, [
					E('div', { 'id': 'modal_agent_status', 'style': 'font-size: 13px; min-height: 20px; line-height: 1.5; color: #64748b;' }, _('Not probed yet')),
					E('button', {
						'type': 'button',
						'id': 'modal_btn_agent_probe',
						'class': 'cbi-button',
						'style': 'margin-top: 6px;',
						'click': window.refreshAgentStatus
					}, '🔍 ' + _('Probe Channel'))
				])
			]),
			E('div', { 'class': 'cbi-value', 'style': 'display: flex; align-items: flex-start; margin-bottom: 8px; gap: 12px;' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'width: 140px; min-width: 140px; text-align: right; padding-right: 12px; margin: 0; font-weight: 500; font-size: 13px; padding-top: 4px;' }, _('Communication Test')),
				E('div', { 'class': 'cbi-value-field', 'style': 'flex: 1; padding: 0;' }, [
					E('div', { 'style': 'display: flex; gap: 8px; flex-wrap: wrap;' }, [
						E('button', {
							'type': 'button',
							'id': 'modal_btn_test',
							'class': 'cbi-button',
							'click': function() {
								var host = document.getElementById('modal_ap_host').value.trim() || '192.168.100.2';
								var port = document.getElementById('modal_ap_port').value.trim() || '22';
								var user = document.getElementById('modal_ap_user').value.trim() || 'root';
								var pass = document.getElementById('modal_ap_password').value;
								var fb = document.getElementById('modal_ap_test_feedback');
								var btn = document.getElementById('modal_btn_test');

								if (btn) { btn.disabled = true; btn.innerText = _('Testing...'); }
								if (fb) dom.content(fb, E('span', { 'class': 'spinning', 'style': 'color: #3b82f6;' }, _('Testing SSH connection to %s...').replace('%s', host)));

								callTestAp(host, port, user, pass).then(function(res) {
									if (btn) { btn.disabled = false; btn.innerText = '🔌 ' + _('Test Connection'); }
									if (fb) {
										if (res && res.success) {
											dom.content(fb, E('span', { 'style': 'color: #059669; font-weight: 500;' }, '🟢 ' + (res.msg || _('AP connected successfully!'))));
										} else {
											dom.content(fb, E('span', { 'style': 'color: #dc2626; font-weight: 500;' }, '🔴 ' + (res.error || _('Failed to connect to AP'))));
										}
									}
								}).catch(function(err) {
									if (btn) { btn.disabled = false; btn.innerText = '🔌 ' + _('Test Connection'); }
									if (fb) dom.content(fb, E('span', { 'style': 'color: #dc2626; font-weight: 500;' }, '🔴 ' + err.message));
								});
							}
						}, '🔌 ' + _('Test Connection')),
						E('button', {
							'type': 'button',
							'id': 'modal_btn_pair',
							'class': 'cbi-button cbi-button-action',
							'click': function() {
								var host = document.getElementById('modal_ap_host').value.trim() || '192.168.100.2';
								var port = document.getElementById('modal_ap_port').value.trim() || '22';
								var user = document.getElementById('modal_ap_user').value.trim() || 'root';
								var pass = document.getElementById('modal_ap_password').value;
								var fb = document.getElementById('modal_ap_test_feedback');
								var btn = document.getElementById('modal_btn_pair');

								if (!pass) {
									if (fb) dom.content(fb, E('span', { 'style': 'color: #dc2626; font-weight: 500;' }, '⚠️ ' + _('Please enter the AP SSH password first to deploy key trust!')));
									document.getElementById('modal_ap_password').focus();
									return;
								}

								if (btn) { btn.disabled = true; btn.innerText = _('Pairing...'); }
								if (fb) dom.content(fb, E('span', { 'class': 'spinning', 'style': 'color: #3b82f6;' }, _('Deploying SSH public key to child AP for passwordless communication...')));

								callPairAp(host, port, user, pass).then(function(res) {
									if (btn) { btn.disabled = false; btn.innerText = '⚡ ' + _('Auto Pair & Trust'); }
									if (fb) {
										if (res && res.success) {
											dom.content(fb, E('span', { 'style': 'color: #059669; font-weight: 500;' }, '🎉 ' + (res.msg || _('SSH key trust successfully deployed!'))));
										} else {
											dom.content(fb, E('span', { 'style': 'color: #dc2626; font-weight: 500;' }, '🔴 ' + (res.error || _('Failed to deploy SSH key trust'))));
										}
									}
								}).catch(function(err) {
									if (btn) { btn.disabled = false; btn.innerText = '⚡ ' + _('Auto Pair & Trust'); }
									if (fb) dom.content(fb, E('span', { 'style': 'color: #dc2626; font-weight: 500;' }, '🔴 ' + err.message));
								});
							}
						}, '⚡ ' + _('Auto Pair & Trust'))
					]),
					E('div', { 'id': 'modal_ap_test_feedback', 'style': 'margin-top: 8px; font-size: 13px; min-height: 20px; line-height: 1.5;' })
				])
			])
		]),
		E('div', { 'class': 'right', 'style': 'margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px;' }, [
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
					/* 先把弹窗里的值存好，再让 AP 重载网络 */
					var host = document.getElementById('modal_ap_host');
					var token = document.getElementById('modal_ap_token');
					var transport = document.getElementById('modal_ap_transport');
					if (host && host.value.trim()) uci.set('omniclash', 'config', 'ap_host', host.value.trim());
					if (token) uci.set('omniclash', 'config', 'ap_token', token.value.trim());
					if (transport) uci.set('omniclash', 'config', 'ap_transport', transport.value);

					uci.save().then(function() { return uci.apply(); }).then(function() {
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
					var host = document.getElementById('modal_ap_host').value.trim();
					var port = document.getElementById('modal_ap_port').value.trim() || '22';
					var user = document.getElementById('modal_ap_user').value.trim() || 'root';
					var pass = document.getElementById('modal_ap_password').value;
					var token = document.getElementById('modal_ap_token').value.trim();
					var transport = document.getElementById('modal_ap_transport').value;

					if (host) uci.set('omniclash', 'config', 'ap_host', host);
					if (port) uci.set('omniclash', 'config', 'ap_port', port);
					if (user) uci.set('omniclash', 'config', 'ap_user', user);
					if (pass !== undefined && pass !== '') uci.set('omniclash', 'config', 'ap_password', pass);
					uci.set('omniclash', 'config', 'ap_token', token || '');
					uci.set('omniclash', 'config', 'ap_transport', transport || 'auto');

					uci.save().then(function() {
						return uci.apply();
					}).then(function() {
						ui.hideModal();
						ui.addNotification(null, E('p', {}, '✅ ' + _('AP configuration saved successfully!')), 'success');
					}).catch(function(err) {
						ui.hideModal();
						ui.addNotification(null, E('p', {}, err.message), 'error');
					});
				}
			}, _('Save'))
		])
	]);

	ui.showModal(_('Child AP Configuration & Authentication'), modalContent);
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
					E('p', { 'style': 'color: #94a3b8; margin: 4px 0 0 0; font-size: 12px; line-height: 1.5;' },
						_('System will automatically link AP radios, dedicated VLANs, DHCP pools, and routing rules to fill all empty slots.')
					)
				]),
				E('div', { 'style': 'max-height: 320px; overflow-y: auto; border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 6px; margin-bottom: 20px;' }, [
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse; margin: 0; font-size: 12px;' }, [
						E('thead', {}, [
							E('tr', { 'style': 'background: rgba(15, 23, 42, 0.5);' }, [
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

				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Operating Mode')),
					E('div', { 'class': 'cbi-value-field', 'style': 'display: flex; align-items: center; gap: 10px; flex-wrap: wrap;' }, [
						E('select', {
							'id': 'tab_run_mode',
							'class': 'cbi-input-select',
							'style': 'width: 320px;',
							'change': function() {
								var btn = document.getElementById('tab_ap_config_btn_wrap');
								if (btn) btn.style.display = (this.value === 'ap') ? 'inline-block' : 'none';
							}
						}, (function() {
							var opts = [
								E('option', { 'value': 'ap', 'selected': curRunMode === 'ap' ? 'selected' : null }, _('Remote Child AP Mode (Main Router + AP, Recommended)'))
							];
							if (hasLocalWifi) {
								opts.push(
									E('option', { 'value': 'local', 'selected': curRunMode === 'local' ? 'selected' : null }, _('Local Host Mode (Single All-in-One Router)'))
								);
							}
							return opts;
						})()),
						E('span', {
							'id': 'tab_ap_config_btn_wrap',
							'style': 'display: ' + (curRunMode === 'ap' ? 'inline-block' : 'none') + ';'
						}, [
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-action',
								'click': window.openApConfigModal
							}, '⚙️ ' + _('Configure Child AP'))
						]),
						(!hasLocalWifi) ? E('div', { 'class': 'cbi-value-description', 'style': 'width: 100%;' }, _('No local Wi-Fi module detected on this host. Operating in Remote Child AP mode.')) : ''
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
							var newRunMode = document.getElementById('tab_run_mode').value;
							var newWirelessMode = document.getElementById('tab_wireless_mode').value;
							ui.showModal(_('Saving & Applying'), [ E('p', { 'class': 'spinning' }, _('Saving operating modes and reloading configuration...')) ]);
							uci.set('omniclash', 'config', 'run_mode', newRunMode);
							uci.set('omniclash', 'config', 'wireless_mode', newWirelessMode);
							Promise.all([
								uci.save(),
								uci.apply()
							]).then(function() {
								return fs.exec_direct('/usr/bin/omniclash', ['compile']);
							}).then(function() {
								return fs.exec_direct('/usr/bin/omniclash', ['reload']);
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
			var multiRows = slots.map(function(slot) {
				var vlanDisplay = _('Dedicated (VLAN %s)').replace('%s', (slot.vlan || (100 + parseInt(slot.num, 10))));
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
						}, isOff ? _('Disabled') : _('Broadcasting'))
					]),
					E('td', { 'style': 'text-align: center; width: 70px; vertical-align: middle;' }, [
						E('span', { 'style': 'font-weight: bold; font-size: 13px; color: ' + (slot.clients > 0 ? '#10b981' : '#94a3b8') }, isOff ? '-' : (slot.clients || 0))
					]),
					E('td', { 'style': 'width: 150px; white-space: nowrap; text-align: center; vertical-align: middle;' }, [
						E('button', {
							'class': 'cbi-button cbi-button-apply',
							'style': 'margin-right: 6px;',
							'click': function() { saveSlotWifiOnly(slot.sid, slot.num); }
						}, _('Save')),
						E('button', {
							'class': isOff ? 'cbi-button cbi-button-action' : 'cbi-button cbi-button-neutral',
							'click': function() { toggleSlotWifi(slot.sid, slot.num, !isOff); }
						}, isOff ? _('Enable') : _('Disable'))
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
						E('div', { 'style': 'font-size: 13px; color: #94a3b8;' }, multiSubtitle)
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
				E('div', { 'class': 'cbi-section' }, [
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse;' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'style': 'width: 50px; text-align: center;' }, _('Slot')),
								E('th', { 'style': 'width: 55px; text-align: center;' }, _('Band')),
								E('th', { 'style': 'width: 180px;' }, _('WiFi Name (SSID)')),
								E('th', { 'style': 'width: 140px;' }, _('WiFi Password')),
								E('th', { 'style': 'width: 150px; text-align: center;' }, _('Dedicated VLAN')),
								E('th', { 'style': 'text-align: center; width: 80px;' }, _('Broadcast Status')),
								E('th', { 'style': 'text-align: center; width: 70px;' }, _('Online Clients')),
								E('th', { 'style': 'width: 150px; text-align: center;' }, _('Actions'))
							])
						]),
						E('tbody', {}, multiRows.length ? multiRows : [ E('tr', {}, [ E('td', { 'colspan': '8', 'style': 'text-align: center; padding: 24px; color: #94a3b8;' }, _('Loading 32-slot AP matrix...')) ]) ])
					])
				])
			]);
		} else {
			// 标准普通双频 WiFi 视图
			var normalRows = slots.map(function(item) {
				var isOff = !!item.disabled;
				var id = item.id || ('wifi_' + item.band);

				return E('tr', { 'style': isOff ? 'opacity: 0.6; background: rgba(0,0,0,0.06);' : '' }, [
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
							'style': 'padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; background: ' + (isOff ? '#94a3b8' : '#10b981')
						}, isOff ? _('Disabled') : _('Broadcasting'))
					]),
					E('td', { 'style': 'text-align: center; width: 80px; vertical-align: middle;' }, [
						E('span', { 'style': 'font-weight: bold; font-size: 13px; color: ' + (item.clients > 0 ? '#10b981' : '#94a3b8') }, isOff ? '-' : (item.clients || 0))
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
						E('div', { 'style': 'font-size: 13px; color: #94a3b8;' },
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
						E('tbody', {}, normalRows.length ? normalRows : [ E('tr', {}, [ E('td', { 'colspan': '6', 'style': 'text-align: center; padding: 24px; color: #94a3b8;' }, _('No standard WiFi interfaces found.')) ]) ])
					])
				])
			]);
		}

		// 3. 构建 Tab 3: 场景复刻与一键初始化向导 (AP Provisioning)
		var paneProvision = E('div', { 'id': 'pane_provision', 'class': 'matrix-subtab-pane', 'style': 'display: none;' }, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('One-Click AP Provisioning & Cloning')),
				E('p', { 'style': 'color: #94a3b8; margin-bottom: 16px; font-size: 13px; line-height: 1.6;' },
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

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('OmniClash Wireless AP Management Hub')),

			// 三大子 Tab 顶栏导航
			E('div', {
				'style': 'display: flex; gap: 20px; border-bottom: 1px solid rgba(148, 163, 184, 0.25); margin-bottom: 20px;'
			}, [
				E('button', {
					'type': 'button',
					'class': 'matrix-subtab-btn',
					'data-tab': 'settings',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid #3b82f6; color: #3b82f6; font-weight: bold;',
					'click': function() { switchMatrixSubTab('settings'); }
				}, '⚙️ ' + _('Mode Settings')),
				E('button', {
					'type': 'button',
					'class': 'matrix-subtab-btn',
					'data-tab': 'wifi',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchMatrixSubTab('wifi'); }
				}, '📶 ' + _('WiFi Settings')),
				E('button', {
					'type': 'button',
					'class': 'matrix-subtab-btn',
					'data-tab': 'provision',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchMatrixSubTab('provision'); }
				}, '⚡ ' + _('AP Provisioning & Clone'))
			]),

			paneSettings,
			paneWifi,
			paneProvision
		]);
	}
});
