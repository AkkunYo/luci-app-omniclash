'use strict';
'require view';
'require rpc';
'require uci';
'require fs';
'require ui';

var callGetProviders = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_providers'
});

var callSaveProviders = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_providers',
	params: [ 'providers' ]
});

var callGetGroups = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_groups'
});

var callSaveGroups = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_groups',
	params: [ 'groups' ]
});

var callResetGroups = rpc.declare({
	object: 'luci.omniclash',
	method: 'reset_groups'
});

var callGetApps = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_apps'
});

var callSaveApps = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_apps',
	params: [ 'apps' ]
});

var callResetApps = rpc.declare({
	object: 'luci.omniclash',
	method: 'reset_apps'
});

var callCompileReload = rpc.declare({
	object: 'luci.omniclash',
	method: 'compile_reload'
});

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('omniclash'),
			callGetProviders(),
			callGetGroups(),
			callGetApps(),
			L.resolveDefault(fs.read('/etc/omniclash/run/config.yaml'), '')
		]);
	},

	render: function(data) {
		var curTcpMode = uci.get('omniclash', 'config', 'tcp_mode') || 'tun';
		var curUdpMode = uci.get('omniclash', 'config', 'udp_mode') || 'tun';
		var curTunStack = uci.get('omniclash', 'config', 'tun_stack') || 'system';
		var curBypassCn = uci.get('omniclash', 'config', 'bypass_china_mainland_ip') || '0';
		var curDnsMode = uci.get('omniclash', 'config', 'dns_mode') || 'fake-ip';
		var curFakeIp = uci.get('omniclash', 'config', 'fake_ip_range') || '198.18.0.1/16';
		var curMixedPort = uci.get('omniclash', 'config', 'mixed_port') || '7890';
		var curSocksPort = uci.get('omniclash', 'config', 'socks_port') || '1080';
		var curLogLevel = uci.get('omniclash', 'config', 'log_level') || 'info';
		var curCronEnable = uci.get('omniclash', 'config', 'scheduled_restart') || '0';
		var curCronTime = uci.get('omniclash', 'config', 'scheduled_restart_cron') || '0 3 * * *';

		var providersList = (data[1] && data[1].providers) ? data[1].providers : [];
		var groupsList = (data[2] && data[2].groups) ? data[2].groups : [];
		var appsList = (data[3] && data[3].apps) ? data[3].apps : [];
		var runConfigContent = data[4] || '';

		var groupTypes = ['select', 'url-test', 'fallback', 'load-balance'];
		var appRuleTypes = ['DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN', 'IP-CIDR', 'GEOSITE', 'GEOIP'];
		var appExpanded = {};

		// 获取当前所有可选走向选项 (DIRECT, REJECT, 以及 groupsList 中的所有策略组名称)
		function getTargetOptions() {
			var targets = ['DIRECT', 'REJECT'];
			groupsList.forEach(function(g) {
				if (g.name && !targets.includes(g.name)) targets.push(g.name);
			});
			return targets;
		}

		window.switchRoutingSubTab = function(tabName) {
			var tabBtns = document.querySelectorAll('.subtab-btn');
			var tabPanes = document.querySelectorAll('.subtab-pane');

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

		// ---------------- 1. Providers 渲染与增删 ----------------
		function renderProviderRows() {
			var tbody = document.getElementById('omniclash_providers_tbody');
			if (!tbody) return;
			tbody.innerHTML = '';

			if (providersList.length === 0) {
				tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">' + _('No subscription providers configured. Click "+ Add Provider" below.') + '</td></tr>';
				return;
			}

			providersList.forEach(function(p, idx) {
				var tr = document.createElement('tr');
				tr.innerHTML = `
					<td style="width: 140px;">
						<input type="text" id="prov_name_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace; font-weight: bold;" value="${p.name || ''}" placeholder="${_('Tag (e.g. vpscloud)')}">
					</td>
					<td style="width: 90px;">
						<input type="text" id="prov_prefix_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace;" value="${p.prefix || ''}" placeholder="${_('Prefix (e.g. vc_)')}">
					</td>
					<td>
						<input type="text" id="prov_url_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace;" value="${p.url || ''}" placeholder="${_('Subscription URL')}">
					</td>
					<td style="width: 90px;">
						<input type="text" id="prov_interval_${idx}" class="cbi-input-text" style="width: 100%; text-align: center;" value="${p.interval || '1800'}">
					</td>
					<td style="width: 70px; text-align: center;">
						<button type="button" class="cbi-button cbi-button-remove" onclick="removeProvider(${idx})">${_('Delete')}</button>
					</td>
				`;
				tbody.appendChild(tr);
			});
		}

		window.removeProvider = function(idx) {
			syncProvidersFromDom();
			providersList.splice(idx, 1);
			renderProviderRows();
		};

		window.addProvider = function() {
			syncProvidersFromDom();
			providersList.push({ name: '', prefix: '', url: '', interval: '1800', type: 'http' });
			renderProviderRows();
		};

		function syncProvidersFromDom() {
			providersList.forEach(function(p, idx) {
				var nameEl = document.getElementById('prov_name_' + idx);
				var prefixEl = document.getElementById('prov_prefix_' + idx);
				var urlEl = document.getElementById('prov_url_' + idx);
				var intEl = document.getElementById('prov_interval_' + idx);
				if (nameEl) p.name = nameEl.value.trim();
				if (prefixEl) p.prefix = prefixEl.value.trim();
				if (urlEl) p.url = urlEl.value.trim();
				if (intEl) p.interval = intEl.value.trim();
			});
		}

		// ---------------- 2. Proxy Groups 策略组渲染与增删 ----------------
		function renderGroupRows() {
			var tbody = document.getElementById('omniclash_groups_tbody');
			if (!tbody) return;
			tbody.innerHTML = '';

			if (groupsList.length === 0) {
				tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">' + _('No proxy groups configured. Click "+ Add Proxy Group" or "Reset to Default Groups".') + '</td></tr>';
				return;
			}

			groupsList.forEach(function(g, idx) {
				var tr = document.createElement('tr');
				var filterStr = g.filter || '';

				tr.innerHTML = `
					<td style="font-weight: bold; width: 40px; text-align: center;">${idx + 1}</td>
					<td style="width: 220px;">
						<input type="text" id="grp_name_${idx}" class="cbi-input-text" style="width: 100%; font-weight: bold; color: #2563eb;" value="${g.name || ''}" placeholder="${_('Group Name')}">
					</td>
					<td style="width: 140px;">
						<select id="grp_type_${idx}" class="cbi-input-select" style="width: 100%;">
							${groupTypes.map(t => `<option value="${t}" ${t === g.type ? 'selected' : ''}>${t}</option>`).join('')}
						</select>
					</td>
					<td>
						<input type="text" id="grp_filter_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace;" value="${filterStr}" placeholder="${_('Filter Regex (e.g. (?i)HK|HongKong)')}">
					</td>
					<td style="width: 70px; text-align: center;">
						<button type="button" class="cbi-button cbi-button-remove" onclick="removeGroup(${idx})">${_('Delete')}</button>
					</td>
				`;
				tbody.appendChild(tr);
			});
		}

		window.removeGroup = function(idx) {
			syncGroupsFromDom();
			groupsList.splice(idx, 1);
			renderGroupRows();
		};

		window.addGroup = function() {
			syncGroupsFromDom();
			groupsList.push({ name: _('New Group'), type: 'select', filter: '(?i)HK|香港', proxies: ['DIRECT'] });
			renderGroupRows();
		};

		window.resetDefaultGroups = function() {
			if (!confirm(_('Are you sure you want to reset proxy groups to default template?\nThis will reset all dedicated lines, regions, and application groups.'))) return;
			ui.showModal(_('Resetting'), [ E('p', { 'class': 'spinning' }, _('Resetting default proxy groups template...')) ]);
			callResetGroups().then(function() {
				return callGetGroups();
			}).then(function(res) {
				groupsList = (res && res.groups) ? res.groups : [];
				renderGroupRows();
				ui.hideModal();
				ui.addNotification(null, E('p', {}, '✅ ' + _('Proxy groups successfully restored to default template!')), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		function syncGroupsFromDom() {
			groupsList.forEach(function(g, idx) {
				var nameEl = document.getElementById('grp_name_' + idx);
				var typeEl = document.getElementById('grp_type_' + idx);
				var filterEl = document.getElementById('grp_filter_' + idx);
				if (nameEl) g.name = nameEl.value.trim();
				if (typeEl) g.type = typeEl.value;
				if (filterEl) g.filter = filterEl.value.trim();
			});
		}

		// ---------------- 3. 应用分流卡片流 (Application Card Stream) ----------------
		function appRuleCount(app) {
			var b = (app.builtin_rules && app.builtin_rules.length) ? app.builtin_rules.length : 0;
			var c = (app.custom_rules && app.custom_rules.length) ? app.custom_rules.length : 0;
			return b + c;
		}

		function appFindIndexById(id) {
			for (var i = 0; i < appsList.length; i++) {
				if (appsList[i] && appsList[i].id === id) return i;
			}
			return -1;
		}

		function renderAppCards() {
			var container = document.getElementById('omniclash_apps_container');
			if (!container) return;
			container.innerHTML = '';

			if (appsList.length === 0) {
				container.appendChild(E('div', {
					'style': 'text-align: center; padding: 24px; color: #94a3b8; font-size: 13px;'
				}, _('No application scenarios configured. Use "+ New Scenario Card" or "Reset to Defaults".')));
				return;
			}

			var targets = getTargetOptions();

			appsList.forEach(function(app, idx) {
				var expanded = !!appExpanded[app.id];
				var enabled = (app.enabled === false || app.enabled === 'false' || app.enabled === '0' || app.enabled === 0) ? false : true;
				var isBuiltin = (app.is_custom !== true);
				var count = appRuleCount(app);

				var targetSel = E('select', {
					'class': 'cbi-input-select',
					'style': 'width: 210px; font-size: 12px;',
					'change': function() {
						appsList[idx].target = this.value;
					}
				}, targets.map(function(t) {
					return E('option', { 'value': t, 'selected': (app.target === t) ? 'selected' : null }, t);
				}));

				var enabledBox = E('input', {
					'type': 'checkbox',
					'title': _('Enable this scenario'),
					'checked': enabled ? 'checked' : null,
					'style': 'cursor: pointer;',
					'change': function() {
						appsList[idx].enabled = this.checked;
					}
				});

				var rowHeader = E('div', {
					'style': 'display: flex; align-items: center; gap: 10px; padding: 10px 12px;' + (enabled ? '' : ' opacity: 0.55;')
				}, [
					E('button', {
						'type': 'button',
						'class': 'cbi-button',
						'style': 'padding: 0 6px; min-width: 24px; font-size: 12px;',
						'title': expanded ? _('Collapse') : _('Expand'),
						'click': function() {
							appExpanded[app.id] = !expanded;
							renderAppCards();
						}
					}, expanded ? '▾' : '▸'),
					E('span', { 'style': 'font-weight: 600; font-size: 13px; min-width: 150px;' }, app.name || app.id),
					E('span', {
						'class': 'badge',
						'style': 'padding: 1px 7px; border-radius: 10px; font-size: 10px; background: rgba(148,163,184,0.18); color: #64748b;'
					}, _('%d rules').replace('%d', count)),
					E('span', { 'style': 'flex: 1;' }),
					E('span', { 'style': 'font-size: 12px; color: #64748b;' }, _('Egress')),
					targetSel,
					E('span', { 'style': 'display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #64748b;' }, [ enabledBox, _('On') ]),
					E('button', {
						'type': 'button',
						'class': 'cbi-button',
						'style': 'padding: 0 6px; min-width: 24px;',
						'disabled': idx === 0 ? 'disabled' : null,
						'title': _('Move Up'),
						'click': function() { window.moveApp(idx, -1); }
					}, '↑'),
					E('button', {
						'type': 'button',
						'class': 'cbi-button',
						'style': 'padding: 0 6px; min-width: 24px;',
						'disabled': idx === appsList.length - 1 ? 'disabled' : null,
						'title': _('Move Down'),
						'click': function() { window.moveApp(idx, 1); }
					}, '↓'),
					isBuiltin ? E('span', {
						'style': 'min-width: 28px; text-align: center; color: #cbd5e1; font-size: 12px;',
						'title': _('Built-in scenario cannot be deleted')
					}, '🔒') : E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-remove',
						'style': 'padding: 0 6px; min-width: 28px;',
						'title': _('Delete'),
						'click': function() { window.removeApp(idx); }
					}, '🗑️')
				]);

				var cardChildren = [ rowHeader ];

				if (expanded) {
					var bodyChildren = [];

					if (app.builtin_rules && app.builtin_rules.length) {
						bodyChildren.push(E('div', { 'style': 'font-size: 11px; color: #94a3b8; margin: 0 0 4px 0;' }, _('Built-in rules')));
						bodyChildren.push(E('div', { 'style': 'font-family: monospace; font-size: 11px; line-height: 1.7; color: #475569; margin-bottom: 10px;' },
							app.builtin_rules.map(function(r) {
								return E('div', {}, (r.type || '?') + ', ' + (r.payload || '?'));
							})
						));
					}

					bodyChildren.push(E('div', { 'style': 'font-size: 11px; color: #94a3b8; margin: 0 0 4px 0;' }, _('Custom rules')));

					if (app.custom_rules && app.custom_rules.length) {
						bodyChildren.push(E('div', { 'style': 'margin-bottom: 8px;' },
							app.custom_rules.map(function(r, ridx) {
								return E('div', { 'style': 'display: flex; align-items: center; gap: 8px; font-family: monospace; font-size: 11px; line-height: 1.9;' }, [
									E('span', { 'style': 'color: #2563eb;' }, (r.type || '?') + ', ' + (r.payload || '?')),
									E('button', {
										'type': 'button',
										'class': 'cbi-button cbi-button-remove',
										'style': 'padding: 0 5px; font-size: 10px;',
										'click': function() { window.removeCustomRule(idx, ridx); }
									}, _('Remove'))
								]);
							})
						));
					} else {
						bodyChildren.push(E('div', { 'style': 'font-size: 11px; color: #cbd5e1; margin-bottom: 8px;' }, _('No custom rules yet.')));
					}

					bodyChildren.push(E('div', { 'style': 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;' }, [
						E('select', {
							'id': 'app_newtype_' + idx,
							'class': 'cbi-input-select',
							'style': 'width: 150px; font-size: 12px;'
						}, appRuleTypes.map(function(t) {
							return E('option', { 'value': t }, t);
						})),
						E('input', {
							'type': 'text',
							'id': 'app_newpayload_' + idx,
							'class': 'cbi-input-text',
							'style': 'width: 260px; font-family: monospace; font-size: 12px;',
							'placeholder': _('Domain or IP (e.g. example.com)')
						}),
						E('button', {
							'type': 'button',
							'class': 'cbi-button cbi-button-action',
							'style': 'font-size: 12px;',
							'click': function() { window.addCustomRule(idx); }
						}, _('Add'))
					]));

					cardChildren.push(E('div', {
						'style': 'padding: 0 12px 12px 46px; border-top: 1px dashed rgba(148,163,184,0.25); padding-top: 10px; margin-top: 2px;'
					}, bodyChildren));
				}

				container.appendChild(E('div', {
					'style': 'border: 1px solid rgba(148,163,184,0.25); border-radius: 6px; margin-bottom: 8px; background: rgba(148,163,184,0.03);'
				}, cardChildren));
			});
		}

		window.moveApp = function(idx, offset) {
			var target = idx + offset;
			if (target < 0 || target >= appsList.length) return;
			var tmp = appsList[idx];
			appsList[idx] = appsList[target];
			appsList[target] = tmp;
			renderAppCards();
		};

		window.removeApp = function(idx) {
			var app = appsList[idx];
			if (!app || app.is_custom !== true) {
				ui.addNotification(null, E('p', {}, _('Built-in scenarios cannot be deleted. Disable them instead.')), 'warning');
				return;
			}
			appsList.splice(idx, 1);
			delete appExpanded[app.id];
			renderAppCards();
		};

		window.addCustomRule = function(idx) {
			var typeEl = document.getElementById('app_newtype_' + idx);
			var payloadEl = document.getElementById('app_newpayload_' + idx);
			if (!typeEl || !payloadEl) return;
			var payload = (payloadEl.value || '').trim();
			if (!payload) {
				ui.addNotification(null, E('p', {}, _('Please enter a domain or IP first.')), 'error');
				return;
			}
			if (!appsList[idx].custom_rules) appsList[idx].custom_rules = [];
			appsList[idx].custom_rules.push({ type: typeEl.value, payload: payload });
			renderAppCards();
		};

		window.removeCustomRule = function(appIdx, ruleIdx) {
			if (!appsList[appIdx] || !appsList[appIdx].custom_rules) return;
			appsList[appIdx].custom_rules.splice(ruleIdx, 1);
			renderAppCards();
		};

		window.openNewAppModal = function() {
			var nameInput = E('input', {
				'type': 'text',
				'class': 'cbi-input-text',
				'id': 'new_app_name',
				'style': 'width: 100%;',
				'placeholder': _('e.g. Company Office')
			});
			var typeSelect = E('select', {
				'class': 'cbi-input-select',
				'id': 'new_app_type',
				'style': 'width: 100%;'
			}, appRuleTypes.map(function(t) {
				return E('option', { 'value': t }, t);
			}));
			var payloadInput = E('input', {
				'type': 'text',
				'class': 'cbi-input-text',
				'id': 'new_app_payload',
				'style': 'width: 100%; font-family: monospace;',
				'placeholder': _('e.g. example.com')
			});
			var targetSelect = E('select', {
				'class': 'cbi-input-select',
				'id': 'new_app_target',
				'style': 'width: 100%;'
			}, getTargetOptions().map(function(t) {
				return E('option', { 'value': t, 'selected': t === '🚀 节点选择' ? 'selected' : null }, t);
			}));

			ui.showModal(_('New Scenario Card'), [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Scenario Name')),
					E('div', { 'class': 'cbi-value-field' }, [ nameInput ])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Rule Type')),
					E('div', { 'class': 'cbi-value-field' }, [ typeSelect ])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Initial Domain / IP')),
					E('div', { 'class': 'cbi-value-field' }, [
						payloadInput,
						E('div', { 'class': 'cbi-value-description' }, _('Optional. Leave blank to create a card with only an egress target.'))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Egress Target')),
					E('div', { 'class': 'cbi-value-field' }, [ targetSelect ])
				]),
				E('div', { 'class': 'right', 'style': 'margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px;' }, [
					E('button', { 'type': 'button', 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')),
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-apply',
						'click': function() {
							var name = (nameInput.value || '').trim();
							if (!name) {
								ui.addNotification(null, E('p', {}, _('Scenario name cannot be empty.')), 'error');
								return;
							}
							var payload = (payloadInput.value || '').trim();
							var baseId = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
							if (!baseId || baseId === 'custom_') baseId = 'custom_card';
							var newId = baseId;
							var n = 2;
							while (appFindIndexById(newId) >= 0) {
								newId = baseId + '_' + n;
								n++;
							}
							var card = {
								id: newId,
								name: name,
								desc: '',
								target: targetSelect.value,
								builtin_rules: [],
								custom_rules: payload ? [ { type: typeSelect.value, payload: payload } ] : [],
								enabled: true,
								is_custom: true
							};
							appsList.push(card);
							appExpanded[newId] = true;
											ui.hideModal();
							renderAppCards();
						}
					}, _('Create'))
				])
			]);
		};

		window.resetDefaultApps = function() {
			if (!confirm(_('Are you sure you want to restore the full default application library?\nAll custom scenarios and custom rules will be discarded.'))) return;
			ui.showModal(_('Resetting'), [ E('p', { 'class': 'spinning' }, _('Restoring default application library...')) ]);
			callResetApps().then(function() {
				return callGetApps();
			}).then(function(res) {
				appsList = (res && res.apps) ? res.apps : [];
				appExpanded = {};
				renderAppCards();
				ui.hideModal();
				ui.addNotification(null, E('p', {}, '✅ ' + _('Default application library restored successfully!')), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};


		// ---------------- 4. 终极全量保存处理函数 ----------------
		window.saveAllRoutingSettings = function() {
			syncProvidersFromDom();
			syncGroupsFromDom();

			var newTcp = document.getElementById('tab_tcp_mode').value;
			var newUdp = document.getElementById('tab_udp_mode').value;
			var newStack = document.getElementById('tab_tun_stack').value;
			var newBypass = document.getElementById('tab_bypass_cn').value;
			var newDns = document.getElementById('tab_dns_mode').value;
			var newFake = document.getElementById('tab_fake_ip').value.trim();
			var newMixed = document.getElementById('tab_mixed_port').value.trim();
			var newSocks = document.getElementById('tab_socks_port').value.trim();
			var newLogLevel = document.getElementById('tab_log_level').value;
			var newCronEn = document.getElementById('tab_cron_enable').checked ? '1' : '0';
			var newCronTime = document.getElementById('tab_cron_time').value.trim();

			var cnTargetEl = document.getElementById('tab_cn_target');
			var finalTargetEl = document.getElementById('tab_final_target');

			var validProviders = providersList.filter(p => p.name && p.url);
			var validGroups = groupsList.filter(g => g.name);
			var validApps = appsList.filter(a => a && a.name);

			ui.showModal(_('Saving & Applying'), [ E('p', { 'class': 'spinning' }, _('Saving settings, providers, groups, application cards, and compiling configuration...')) ]);

			uci.set('omniclash', 'config', 'tcp_mode', newTcp);
			uci.set('omniclash', 'config', 'udp_mode', newUdp);
			uci.set('omniclash', 'config', 'tun_stack', newStack);
			uci.set('omniclash', 'config', 'bypass_china_mainland_ip', newBypass);
			uci.set('omniclash', 'config', 'dns_mode', newDns);
			uci.set('omniclash', 'config', 'fake_ip_range', newFake);
			uci.set('omniclash', 'config', 'mixed_port', newMixed);
			uci.set('omniclash', 'config', 'socks_port', newSocks);
			uci.set('omniclash', 'config', 'log_level', newLogLevel);
			uci.set('omniclash', 'config', 'scheduled_restart', newCronEn);
			uci.set('omniclash', 'config', 'scheduled_restart_cron', newCronTime);
			if (cnTargetEl) uci.set('omniclash', 'config', 'cn_target', cnTargetEl.value);
			if (finalTargetEl) uci.set('omniclash', 'config', 'final_target', finalTargetEl.value);

			var sentCardCount = validApps.length;
			var sentCustomRules = validApps.reduce(function(acc, a) {
				return acc + ((a.custom_rules && a.custom_rules.length) ? a.custom_rules.length : 0);
			}, 0);

			Promise.all([
				uci.save(),
				uci.apply(),
				callSaveProviders(validProviders),
				callSaveGroups(validGroups),
				callSaveApps(validApps)
			]).then(function() {
				return callCompileReload();
			}).then(function() {
				// save_apps 在引擎拒绝非法载荷时仍返回成功，必须回读校验实际落库结果
				return callGetApps().then(function(res) {
					var stored = (res && res.apps) ? res.apps : [];
					var storedCustom = stored.reduce(function(acc, a) {
						return acc + ((a.custom_rules && a.custom_rules.length) ? a.custom_rules.length : 0);
					}, 0);
					if (!res || res.success === false || stored.length !== sentCardCount || storedCustom !== sentCustomRules) {
						throw new Error(_('Application card library was not saved as expected. Please check the log for details.'));
					}
					return true;
				});
			}).then(function() {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, '✅ ' + _('All settings, providers, groups, and application cards successfully saved and applied!')), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		var viewEl = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('OmniClash Subscription & Routing Hub')),

			// 五大子 Tab 顶栏导航
			E('div', {
				'style': 'display: flex; gap: 20px; border-bottom: 1px solid rgba(148, 163, 184, 0.25); margin-bottom: 20px;'
			}, [
				E('button', {
					'type': 'button',
					'class': 'subtab-btn',
					'data-tab': 'settings',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid #3b82f6; color: #3b82f6; font-weight: bold;',
					'click': function() { switchRoutingSubTab('settings'); }
				}, '⚙️ ' + _('Core Settings')),
				E('button', {
					'type': 'button',
					'class': 'subtab-btn',
					'data-tab': 'providers',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchRoutingSubTab('providers'); }
				}, '📦 ' + _('Provider Subscriptions')),
				E('button', {
					'type': 'button',
					'class': 'subtab-btn',
					'data-tab': 'groups',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchRoutingSubTab('groups'); }
				}, '🎯 ' + _('Proxy Groups')),
				E('button', {
					'type': 'button',
					'class': 'subtab-btn',
					'data-tab': 'rules',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchRoutingSubTab('rules'); }
				}, '🔀 ' + _('Application Routing Cards')),
				E('button', {
					'type': 'button',
					'class': 'subtab-btn',
					'data-tab': 'runconfig',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchRoutingSubTab('runconfig'); }
				}, '📄 ' + _('Running Config (Readonly)'))
			]),

			// 子 Tab 1: 核心与高级设置
			E('div', { 'id': 'pane_settings', 'class': 'subtab-pane', 'style': 'display: block;' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('1. Traffic Proxy & System TUN Settings')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('TCP Proxy Mode')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_tcp_mode', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'tun', 'selected': curTcpMode === 'tun' ? 'selected' : null }, _('TUN (Pure TUN Mode, Recommended)')),
								E('option', { 'value': 'tproxy', 'selected': curTcpMode === 'tproxy' ? 'selected' : null }, _('TPROXY (Transparent Proxy)')),
								E('option', { 'value': 'redirect', 'selected': curTcpMode === 'redirect' ? 'selected' : null }, _('Redirect'))
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('UDP Proxy Mode')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_udp_mode', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'tun', 'selected': curUdpMode === 'tun' ? 'selected' : null }, _('TUN (Pure TUN Mode, Recommended)')),
								E('option', { 'value': 'tproxy', 'selected': curUdpMode === 'tproxy' ? 'selected' : null }, _('TPROXY (Transparent Proxy)'))
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('System TUN Stack')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_tun_stack', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'system', 'selected': curTunStack === 'system' ? 'selected' : null }, _('System (Kernel Native, High Performance)')),
								E('option', { 'value': 'gvisor', 'selected': curTunStack === 'gvisor' ? 'selected' : null }, _('gVisor (Userspace Sandbox)')),
								E('option', { 'value': 'mixed', 'selected': curTunStack === 'mixed' ? 'selected' : null }, _('Mixed'))
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Bypass China Mainland IP')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_bypass_cn', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': '0', 'selected': curBypassCn === '0' ? 'selected' : null }, _('Disabled (Managed by OmniClash rules, Recommended)')),
								E('option', { 'value': '1', 'selected': curBypassCn === '1' ? 'selected' : null }, _('Enabled (Bypass CN IP directly)'))
							]),
							E('div', { 'class': 'cbi-value-description' }, _('Recommended to keep disabled; OmniClash slot rules determine direct connection vs proxies.'))
						])
					])
				]),

				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('2. Inbound Proxy Ports')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Mixed Proxy Port')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'text', 'id': 'tab_mixed_port', 'class': 'cbi-input-text', 'style': 'width: 180px; font-family: monospace;', 'value': curMixedPort }),
							E('span', { 'style': 'color: #94a3b8; margin-left: 8px;' }, _('(Default: 7890, supports HTTP/SOCKS5 mixed)'))
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('SOCKS5 Port')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'text', 'id': 'tab_socks_port', 'class': 'cbi-input-text', 'style': 'width: 180px; font-family: monospace;', 'value': curSocksPort }),
							E('span', { 'style': 'color: #94a3b8; margin-left: 8px;' }, _('(Default: 1080)'))
						])
					])
				]),

				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('3. DNS & Fake-IP Settings')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('DNS Mode')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_dns_mode', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'fake-ip', 'selected': curDnsMode === 'fake-ip' ? 'selected' : null }, _('Fake-IP (Recommended)')),
								E('option', { 'value': 'redir-host', 'selected': curDnsMode === 'redir-host' ? 'selected' : null }, _('Redir-Host (Real IP)'))
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Fake-IP Range')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'id': 'tab_fake_ip', 'type': 'text', 'class': 'cbi-input-text', 'style': 'width: 280px; font-family: monospace;', 'value': curFakeIp })
						])
					])
				]),

				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('4. Logging & Scheduled Restart')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Log Level')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_log_level', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'warning', 'selected': curLogLevel === 'warning' ? 'selected' : null }, _('Warning (Lightweight)')),
								E('option', { 'value': 'info', 'selected': curLogLevel === 'info' ? 'selected' : null }, _('Info (Detailed, Recommended)')),
								E('option', { 'value': 'debug', 'selected': curLogLevel === 'debug' ? 'selected' : null }, _('Debug (Troubleshooting)'))
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Scheduled Restart')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'checkbox', 'id': 'tab_cron_enable', 'checked': curCronEnable === '1' ? 'checked' : null }),
							E('span', { 'style': 'margin-left: 8px;' }, _('Enable scheduled task'))
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Cron Expression')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'text', 'id': 'tab_cron_time', 'class': 'cbi-input-text', 'style': 'width: 280px; font-family: monospace;', 'value': curCronTime }),
							E('span', { 'style': 'color: #94a3b8; margin-left: 8px;' }, _('(Default: 0 3 * * * Daily at 03:00)'))
						])
					])
				])
			]),

			// 子 Tab 2: Provider 集
			E('div', { 'id': 'pane_providers', 'class': 'subtab-pane', 'style': 'display: none;' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Provider Subscriptions Source List')),
					E('p', { 'style': 'margin-bottom: 12px;' },
						_('Manage external node pool subscriptions. Only imports proxy nodes without overwriting local rules.')
					),
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse; margin-bottom: 16px;' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'style': 'width: 140px;' }, _('Provider Tag')),
								E('th', { 'style': 'width: 90px;' }, _('Node Prefix')),
								E('th', {}, _('Subscription URL')),
								E('th', { 'style': 'width: 90px; text-align: center;' }, _('Interval (s)')),
								E('th', { 'style': 'width: 70px; text-align: center;' }, _('Actions'))
							])
						]),
						E('tbody', { 'id': 'omniclash_providers_tbody' })
					]),
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-action',
						'click': function() { addProvider(); }
					}, _('+ Add Provider'))
				])
			]),

			// 子 Tab 3: 分流节点组 (真实数据绑定 + 增删改查 + 恢复默认)
			E('div', { 'id': 'pane_groups', 'class': 'subtab-pane', 'style': 'display: none;' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' }, [
						E('div', {}, [
							E('h3', { 'style': 'margin: 0;' }, _('Structured Proxy Groups')),
							E('p', { 'style': 'margin: 4px 0 0 0; color: #94a3b8;' },
								_('Configured proxy groups (dedicated lines, regions, application groups). Automatically connects all provider subscriptions, filtered by node prefix and regex.')
							)
						]),
						E('div', {}, [
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-action',
								'style': 'margin-right: 6px;',
								'click': function() { addGroup(); }
							}, _('+ Add Proxy Group')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-reset',
								'click': function() { resetDefaultGroups(); }
							}, '🔄 ' + _('Reset to Default Groups'))
						])
					]),
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse;' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'style': 'width: 40px; text-align: center;' }, '#'),
								E('th', { 'style': 'width: 220px;' }, _('Group Name')),
								E('th', { 'style': 'width: 140px;' }, _('Group Type')),
								E('th', {}, _('Node Filter (Regex)')),
								E('th', { 'style': 'width: 70px; text-align: center;' }, _('Actions'))
							])
						]),
						E('tbody', { 'id': 'omniclash_groups_tbody' })
					])
				])
			]),

			// 子 Tab 4: 业务应用分流卡片流
			E('div', { 'id': 'pane_rules', 'class': 'subtab-pane', 'style': 'display: none;' }, [
				// 第一层: 物理专线隔离保障说明 (只读)
				E('div', {
					'style': 'background: rgba(16, 185, 129, 0.08); border-left: 4px solid #10b981; padding: 10px 14px; border-radius: 4px; margin-bottom: 16px;'
				}, [
					E('div', { 'style': 'font-weight: bold; color: #059669; margin-bottom: 4px; font-size: 13px;' },
						'🛡️ ' + _('Physical Line Isolation Guarantee')),
					E('div', { 'style': 'font-size: 12px; color: #64748b; line-height: 1.6;' },
						_('Global-mode and targeted-mode WiFi devices are matched at the highest physical priority and always egress through their dedicated proxy. They never fall through to any application card below, preventing IP leaks and rule hijacking.'))
				]),

				// 第二层: 业务应用卡片流
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;' }, [
						E('div', {}, [
							E('h3', { 'style': 'margin: 0;' }, '🚀 ' + _('Application Routing Pipeline')),
							E('p', { 'style': 'margin: 4px 0 0 0; color: #94a3b8; font-size: 12px;' },
								_('Rules are matched top to bottom. Use the arrows to change priority.'))
						]),
						E('div', { 'style': 'display: flex; gap: 6px;' }, [
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-action',
								'click': function() { window.openNewAppModal(); }
							}, '+ ' + _('New Scenario Card')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-reset',
								'click': function() { window.resetDefaultApps(); }
							}, '🔄 ' + _('Reset to Default Library'))
						])
					]),
					E('div', { 'id': 'omniclash_apps_container' })
				]),

				// 第三层: 基础保障与兜底收口
				E('div', { 'class': 'cbi-section', 'style': 'margin-top: 18px;' }, [
					E('h3', { 'style': 'margin: 0 0 4px 0;' }, '⚓ ' + _('Baseline & Final Fallback')),
					E('p', { 'style': 'margin: 0 0 12px 0; color: #94a3b8; font-size: 12px;' },
						_('These two rules are always emitted after every application card and cannot be reordered.')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('China Mainland Direct')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_cn_target', 'class': 'cbi-input-select', 'style': 'width: 240px;' },
								getTargetOptions().map(function(t) {
									var cur = uci.get('omniclash', 'config', 'cn_target') || 'DIRECT';
									return E('option', { 'value': t, 'selected': cur === t ? 'selected' : null }, t);
								})
							),
							E('div', { 'class': 'cbi-value-description' },
								_('Emits GEOSITE,cn and GEOIP,cn to this target for all devices not captured above.'))
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Catch-All Fallback (MATCH)')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_final_target', 'class': 'cbi-input-select', 'style': 'width: 240px;' },
								getTargetOptions().map(function(t) {
									var cur = uci.get('omniclash', 'config', 'final_target') || '🚀 节点选择';
									return E('option', { 'value': t, 'selected': cur === t ? 'selected' : null }, t);
								})
							),
							E('div', { 'class': 'cbi-value-description' },
								_('Terminal MATCH rule. Every remaining unmatched connection egresses through this target.'))
						])
					])
				])
			]),

			// 子 Tab 5: 运行配置 (只读)
			E('div', { 'id': 'pane_runconfig', 'class': 'subtab-pane', 'style': 'display: none;' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;' }, [
						E('div', {}, [
							E('h3', { 'style': 'margin: 0;' }, _('Final Compiled Configuration (/etc/omniclash/run/config.yaml)')),
							E('div', { 'style': 'font-size: 12px; color: #94a3b8; margin-top: 4px;' },
								_('Dynamically compiled from settings, providers, groups, rules, and 32-WiFi matrix (read-only).')
							)
						]),
						E('div', { 'style': 'display: flex; gap: 8px;' }, [
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-action',
								'click': function() {
									fs.read('/etc/omniclash/run/config.yaml').then(function(txt) {
										var el = document.getElementById('omniclash_runconfig_area');
										if (el) el.value = txt || '';
										ui.addNotification(null, E('p', {}, '✅ ' + _('Refreshed latest running configuration!')), 'success');
									});
								}
							}, '🔄 ' + _('Refresh Config')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-neutral',
								'click': function() {
									var el = document.getElementById('omniclash_runconfig_area');
									if (el && navigator.clipboard) {
										navigator.clipboard.writeText(el.value).then(function() {
											ui.addNotification(null, E('p', {}, '✅ ' + _('Running configuration copied to clipboard!')), 'success');
										});
									}
								}
							}, '📋 ' + _('Copy All'))
						])
					]),
					E('textarea', {
						'id': 'omniclash_runconfig_area',
						'class': 'cbi-input-textarea',
						'style': 'width: 100%; height: 560px; font-family: monospace; font-size: 12px; line-height: 1.45;',
						'readonly': 'readonly'
					}, runConfigContent)
				])
			]),

			// 页面最底部统一的原生【保存并应用】操作区
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-apply',
					'click': function() { window.saveAllRoutingSettings(); }
				}, _('Save & Apply'))
			])
		]);

		setTimeout(function() {
			renderProviderRows();
			renderGroupRows();
			renderAppCards();
		}, 50);

		return viewEl;
	}
});
