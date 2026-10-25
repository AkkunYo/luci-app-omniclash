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

var callGetRules = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_rules'
});

var callSaveRules = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_rules',
	params: [ 'rules' ]
});

var callResetRules = rpc.declare({
	object: 'luci.omniclash',
	method: 'reset_rules'
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
			callGetRules(),
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
		var rulesList = (data[3] && data[3].rules) ? data[3].rules : [];
		var runConfigContent = data[4] || '';

		var groupTypes = ['select', 'url-test', 'fallback', 'load-balance'];
		var ruleTypes = ['GEOSITE', 'GEOIP', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN', 'IP-CIDR', 'SRC-IP-CIDR', 'RULE-SET', 'MATCH'];

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

		// ---------------- 3. Rules 规则渲染与增删移动 ----------------
		function renderRuleRows() {
			var tbody = document.getElementById('omniclash_rules_tbody');
			if (!tbody) return;
			tbody.innerHTML = '';

			if (rulesList.length === 0) {
				tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">' + _('No routing rules configured. Click "+ Add Rule" or "Reset to Default Rules".') + '</td></tr>';
				return;
			}

			var targets = getTargetOptions();

			rulesList.forEach(function(r, idx) {
				var tr = document.createElement('tr');
				tr.innerHTML = `
					<td style="font-weight: bold; width: 40px; text-align: center;">${idx + 1}</td>
					<td style="width: 140px;">
						<select id="rule_type_${idx}" class="cbi-input-select" style="width: 100%;">
							${ruleTypes.map(t => `<option value="${t}" ${t === r.type ? 'selected' : ''}>${t}</option>`).join('')}
						</select>
					</td>
					<td>
						<input type="text" id="rule_payload_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace;" value="${r.payload || ''}" placeholder="${_('Payload (e.g. openai, cn, 192.168.1.0/24)')}">
					</td>
					<td style="width: 180px;">
						<select id="rule_target_${idx}" class="cbi-input-select" style="width: 100%;">
							${targets.map(t => `<option value="${t}" ${t === r.target ? 'selected' : ''}>${t}</option>`).join('')}
						</select>
					</td>
					<td style="width: 80px; text-align: center;">
						<input type="checkbox" id="rule_nores_${idx}" ${r.no_resolve ? 'checked' : ''}>
					</td>
					<td style="width: 120px; text-align: center; white-space: nowrap;">
						<button type="button" class="cbi-button" style="padding: 2px 6px; margin-right: 2px;" onclick="moveRule(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>↑</button>
						<button type="button" class="cbi-button" style="padding: 2px 6px; margin-right: 4px;" onclick="moveRule(${idx}, 1)" ${idx === rulesList.length - 1 ? 'disabled' : ''}>↓</button>
						<button type="button" class="cbi-button cbi-button-remove" style="padding: 2px 6px;" onclick="removeRule(${idx})">${_('Delete')}</button>
					</td>
				`;
				tbody.appendChild(tr);
			});
		}

		window.moveRule = function(idx, offset) {
			syncRulesFromDom();
			var targetIdx = idx + offset;
			if (targetIdx < 0 || targetIdx >= rulesList.length) return;
			var temp = rulesList[idx];
			rulesList[idx] = rulesList[targetIdx];
			rulesList[targetIdx] = temp;
			renderRuleRows();
		};

		window.removeRule = function(idx) {
			syncRulesFromDom();
			rulesList.splice(idx, 1);
			renderRuleRows();
		};

		window.addRule = function() {
			syncRulesFromDom();
			rulesList.push({ type: 'GEOSITE', payload: '', target: 'DIRECT', no_resolve: false });
			renderRuleRows();
		};

		window.resetDefaultRules = function() {
			if (!confirm(_('Are you sure you want to reset to default rules?\nThis will reset 69+ rules including AI, YouTube, Google, and DIRECT.'))) return;
			ui.showModal(_('Resetting'), [ E('p', { 'class': 'spinning' }, _('Resetting default routing rules...')) ]);
			callResetRules().then(function() {
				return callGetRules();
			}).then(function(res) {
				rulesList = (res && res.rules) ? res.rules : [];
				renderRuleRows();
				ui.hideModal();
				ui.addNotification(null, E('p', {}, '✅ ' + _('Routing rules successfully restored to default!')), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		function syncRulesFromDom() {
			rulesList.forEach(function(r, idx) {
				var typeEl = document.getElementById('rule_type_' + idx);
				var payloadEl = document.getElementById('rule_payload_' + idx);
				var targetEl = document.getElementById('rule_target_' + idx);
				var noResEl = document.getElementById('rule_nores_' + idx);
				if (typeEl) r.type = typeEl.value;
				if (payloadEl) r.payload = payloadEl.value.trim();
				if (targetEl) r.target = targetEl.value;
				if (noResEl) r.no_resolve = noResEl.checked;
			});
		}

		// ---------------- 4. 终极全量保存处理函数 ----------------
		window.saveAllRoutingSettings = function() {
			syncProvidersFromDom();
			syncGroupsFromDom();
			syncRulesFromDom();

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

			var validProviders = providersList.filter(p => p.name && p.url);
			var validGroups = groupsList.filter(g => g.name);
			var validRules = rulesList.filter(r => (r.type === 'MATCH' || r.payload));

			ui.showModal(_('Saving & Applying'), [ E('p', { 'class': 'spinning' }, _('Saving settings, providers, groups, rules, and compiling configuration...')) ]);

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

			Promise.all([
				uci.save(),
				uci.apply(),
				callSaveProviders(validProviders),
				callSaveGroups(validGroups),
				callSaveRules(validRules)
			]).then(function() {
				return callCompileReload();
			}).then(function() {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, '✅ ' + _('All settings, providers, groups, and rules successfully saved and applied!')), 'success');
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
				}, '🔀 ' + _('Rules')),
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

			// 子 Tab 4: 分流规则 (真实数据绑定 + 增删改查 + 恢复默认)
			E('div', { 'id': 'pane_rules', 'class': 'subtab-pane', 'style': 'display: none;' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' }, [
						E('div', {}, [
							E('h3', { 'style': 'margin: 0;' }, _('Traffic Routing Rules')),
							E('p', { 'style': 'margin: 4px 0 0 0; color: #94a3b8;' },
								_('Preconfigured 69+ rule library. Supports modifying match criteria, target groups, and reordering priority.')
							)
						]),
						E('div', {}, [
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-action',
								'style': 'margin-right: 6px;',
								'click': function() { addRule(); }
							}, _('+ Add Rule')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-reset',
								'click': function() { resetDefaultRules(); }
							}, '🔄 ' + _('Reset to Default Rules'))
						])
					]),
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse; margin-bottom: 12px;' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'style': 'width: 40px; text-align: center;' }, '#'),
								E('th', { 'style': 'width: 140px;' }, _('Rule Type')),
								E('th', {}, _('Payload (Domain / IP / GeoTag)')),
								E('th', { 'style': 'width: 180px;' }, _('Target (Group / DIRECT / REJECT)')),
								E('th', { 'style': 'width: 80px; text-align: center;' }, _('No-Resolve')),
								E('th', { 'style': 'width: 120px; text-align: center;' }, _('Actions'))
							])
						]),
						E('tbody', { 'id': 'omniclash_rules_tbody' })
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
			renderRuleRows();
		}, 50);

		return viewEl;
	}
});
