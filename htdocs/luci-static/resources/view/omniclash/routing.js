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
				tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">暂无子订阅 Provider，点击下方【+ 添加新 Provider】添加</td></tr>';
				return;
			}

			providersList.forEach(function(p, idx) {
				var tr = document.createElement('tr');
				tr.innerHTML = `
					<td style="width: 140px;">
						<input type="text" id="prov_name_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace; font-weight: bold;" value="${p.name || ''}" placeholder="标识名 (如 vpscloud)">
					</td>
					<td style="width: 90px;">
						<input type="text" id="prov_prefix_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace;" value="${p.prefix || ''}" placeholder="前缀(如 vc_)">
					</td>
					<td>
						<input type="text" id="prov_url_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace;" value="${p.url || ''}" placeholder="订阅文件地址 URL">
					</td>
					<td style="width: 90px;">
						<input type="text" id="prov_interval_${idx}" class="cbi-input-text" style="width: 100%; text-align: center;" value="${p.interval || '1800'}">
					</td>
					<td style="width: 70px; text-align: center;">
						<button type="button" class="cbi-button cbi-button-remove" onclick="removeProvider(${idx})">删除</button>
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
				tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">暂无策略组，可点击【+ 添加新策略组】或【恢复默认策略组】</td></tr>';
				return;
			}

			groupsList.forEach(function(g, idx) {
				var tr = document.createElement('tr');
				var useStr = (g.use && g.use.length) ? g.use.join(', ') : '-';
				var filterStr = g.filter || '';

				tr.innerHTML = `
					<td style="font-weight: bold; width: 40px;">${idx + 1}</td>
					<td style="width: 180px;">
						<input type="text" id="grp_name_${idx}" class="cbi-input-text" style="width: 100%; font-weight: bold; color: #2563eb;" value="${g.name || ''}" placeholder="组名称">
					</td>
					<td style="width: 120px;">
						<select id="grp_type_${idx}" class="cbi-input-select" style="width: 100%;">
							${groupTypes.map(t => `<option value="${t}" ${t === g.type ? 'selected' : ''}>${t}</option>`).join('')}
						</select>
					</td>
					<td style="width: 220px;">
						<input type="text" id="grp_filter_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace;" value="${filterStr}" placeholder="节点过滤正则 (如 (?i)HK|香港)">
					</td>
					<td style="width: 150px;">
						<input type="text" id="grp_use_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace;" value="${useStr}" placeholder="使用Provider(逗号分隔)">
					</td>
					<td style="width: 70px; text-align: center;">
						<button type="button" class="cbi-button cbi-button-remove" onclick="removeGroup(${idx})">删除</button>
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
			groupsList.push({ name: '新策略组', type: 'select', filter: '', use: ['vpscloud'], proxies: ['🟢 直连'] });
			renderGroupRows();
		};

		window.resetDefaultGroups = function() {
			if (!confirm('确定要将策略组恢复为全套默认模板吗？\n将重置所有专线组、地区组与应用组配置。')) return;
			ui.showModal(_('正在恢复'), [ E('p', { 'class': 'spinning' }, _('正在恢复默认策略组模板...')) ]);
			callResetGroups().then(function() {
				return callGetGroups();
			}).then(function(res) {
				groupsList = (res && res.groups) ? res.groups : [];
				renderGroupRows();
				ui.hideModal();
				ui.addNotification(null, E('p', {}, _('✅ 策略组已成功恢复为默认模板！')), 'success');
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
				var useEl = document.getElementById('grp_use_' + idx);
				if (nameEl) g.name = nameEl.value.trim();
				if (typeEl) g.type = typeEl.value;
				if (filterEl) g.filter = filterEl.value.trim();
				if (useEl) {
					var rawUse = useEl.value.trim();
					g.use = (rawUse && rawUse !== '-') ? rawUse.split(',').map(s => s.trim()).filter(Boolean) : [];
				}
			});
		}

		// ---------------- 3. Rules 规则渲染与增删移动 ----------------
		function renderRuleRows() {
			var tbody = document.getElementById('omniclash_rules_tbody');
			if (!tbody) return;
			tbody.innerHTML = '';

			if (rulesList.length === 0) {
				tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">暂无分流规则，可点击【+ 添加新规则】或【恢复默认规则库】</td></tr>';
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
						<input type="text" id="rule_payload_${idx}" class="cbi-input-text" style="width: 100%; font-family: monospace;" value="${r.payload || ''}" placeholder="匹配值 (如 openai, cn, 192.168.1.0/24)">
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
						<button type="button" class="cbi-button cbi-button-remove" style="padding: 2px 6px;" onclick="removeRule(${idx})">删</button>
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
			if (!confirm('确定要恢复为系统默认全套分流规则库吗？\n将重置包含 AI、YouTube、Google、私网与国内直连等 69+ 条规则。')) return;
			ui.showModal(_('正在恢复'), [ E('p', { 'class': 'spinning' }, _('正在恢复默认分流规则库...')) ]);
			callResetRules().then(function() {
				return callGetRules();
			}).then(function(res) {
				rulesList = (res && res.rules) ? res.rules : [];
				renderRuleRows();
				ui.hideModal();
				ui.addNotification(null, E('p', {}, _('✅ 分流规则已成功恢复为默认规则库！')), 'success');
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

			ui.showModal(_('正在保存并应用'), [ E('p', { 'class': 'spinning' }, _('正在写入全量核心设置、Provider、策略组与分流规则并合流生效...')) ]);

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
				ui.addNotification(null, E('p', {}, _('✅ 全量设置、Provider订阅、策略组与分流规则已全部保存并合流生效！')), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		var viewEl = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('OmniClash 订阅与分流中枢')),

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
				}, _('⚙️ 核心与高级设置')),
				E('button', {
					'type': 'button',
					'class': 'subtab-btn',
					'data-tab': 'providers',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchRoutingSubTab('providers'); }
				}, _('📦 Provider 订阅集')),
				E('button', {
					'type': 'button',
					'class': 'subtab-btn',
					'data-tab': 'groups',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchRoutingSubTab('groups'); }
				}, _('🎯 分流节点组')),
				E('button', {
					'type': 'button',
					'class': 'subtab-btn',
					'data-tab': 'rules',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchRoutingSubTab('rules'); }
				}, _('🔀 分流规则 (Rule)')),
				E('button', {
					'type': 'button',
					'class': 'subtab-btn',
					'data-tab': 'runconfig',
					'style': 'background: none; border: none; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent;',
					'click': function() { switchRoutingSubTab('runconfig'); }
				}, _('📄 运行配置 (只读)'))
			]),

			// 子 Tab 1: 核心与高级设置
			E('div', { 'id': 'pane_settings', 'class': 'subtab-pane', 'style': 'display: block;' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('1. 流量代理与系统 TUN 设置 (对标 Nikki 核心代理能力)')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('TCP 代理模式')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_tcp_mode', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'tun', 'selected': curTcpMode === 'tun' ? 'selected' : null }, _('TUN (纯 TUN 模式，零泄漏推荐)')),
								E('option', { 'value': 'tproxy', 'selected': curTcpMode === 'tproxy' ? 'selected' : null }, _('TPROXY (透明代理)')),
								E('option', { 'value': 'redirect', 'selected': curTcpMode === 'redirect' ? 'selected' : null }, _('Redirect (重定向)'))
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('UDP 代理模式')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_udp_mode', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'tun', 'selected': curUdpMode === 'tun' ? 'selected' : null }, _('TUN (纯 TUN 模式，零泄漏推荐)')),
								E('option', { 'value': 'tproxy', 'selected': curUdpMode === 'tproxy' ? 'selected' : null }, _('TPROXY (透明代理)'))
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('系统 TUN 网络堆栈')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_tun_stack', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'system', 'selected': curTunStack === 'system' ? 'selected' : null }, _('System (内核原生，极高性能)')),
								E('option', { 'value': 'gvisor', 'selected': curTunStack === 'gvisor' ? 'selected' : null }, _('gVisor (用户态沙箱)')),
								E('option', { 'value': 'mixed', 'selected': curTunStack === 'mixed' ? 'selected' : null }, _('Mixed (混合模式)'))
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('绕过中国大陆 IP')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_bypass_cn', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': '0', 'selected': curBypassCn === '0' ? 'selected' : null }, _('关闭 (由 OmniClash 槽位规则决定，推荐)')),
								E('option', { 'value': '1', 'selected': curBypassCn === '1' ? 'selected' : null }, _('开启 (内核直接绕过大陆 IP)'))
							]),
							E('div', { 'class': 'cbi-value-description' }, _('建议保持关闭，由 OmniClash 槽位规则决定直连还是走专线。'))
						])
					])
				]),

				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('2. 本地代理端口设置 (对标 Nikki 端口能力)')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Mixed 混合代理端口')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'text', 'id': 'tab_mixed_port', 'class': 'cbi-input-text', 'style': 'width: 180px; font-family: monospace;', 'value': curMixedPort }),
							E('span', { 'style': 'color: #94a3b8; margin-left: 8px;' }, _('(默认 7890，支持 HTTP/SOCKS5 混合连接)'))
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('SOCKS5 独立端口')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'text', 'id': 'tab_socks_port', 'class': 'cbi-input-text', 'style': 'width: 180px; font-family: monospace;', 'value': curSocksPort }),
							E('span', { 'style': 'color: #94a3b8; margin-left: 8px;' }, _('(默认 1080)'))
						])
					])
				]),

				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('3. DNS 模块与 Fake-IP 设置 (对标 Nikki DNS 能力)')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('DNS 运行模式')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_dns_mode', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'fake-ip', 'selected': curDnsMode === 'fake-ip' ? 'selected' : null }, _('Fake-IP (虚拟 IP，秒开推荐)')),
								E('option', { 'value': 'redir-host', 'selected': curDnsMode === 'redir-host' ? 'selected' : null }, _('Redir-Host (真实 IP)'))
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Fake-IP 网段范围')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'id': 'tab_fake_ip', 'type': 'text', 'class': 'cbi-input-text', 'style': 'width: 280px; font-family: monospace;', 'value': curFakeIp })
						])
					])
				]),

				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('4. 核心日志与定时守护 (对标 Nikki 日志与 Cron 能力)')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('内核日志等级')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'tab_log_level', 'class': 'cbi-input-select', 'style': 'width: 280px;' }, [
								E('option', { 'value': 'warning', 'selected': curLogLevel === 'warning' ? 'selected' : null }, 'Warning (仅告警，轻量)'),
								E('option', { 'value': 'info', 'selected': curLogLevel === 'info' ? 'selected' : null }, 'Info (正常详细，推荐)'),
								E('option', { 'value': 'debug', 'selected': curLogLevel === 'debug' ? 'selected' : null }, 'Debug (深度排错)')
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('开启定时重启/重载')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'checkbox', 'id': 'tab_cron_enable', 'checked': curCronEnable === '1' ? 'checked' : null }),
							E('span', { 'style': 'margin-left: 8px;' }, _('启用定时任务'))
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('定时 Cron 表达式')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'text', 'id': 'tab_cron_time', 'class': 'cbi-input-text', 'style': 'width: 280px; font-family: monospace;', 'value': curCronTime }),
							E('span', { 'style': 'color: #94a3b8; margin-left: 8px;' }, _('(默认 0 3 * * * 每天凌晨3点)'))
						])
					])
				])
			]),

			// 子 Tab 2: Provider 集
			E('div', { 'id': 'pane_providers', 'class': 'subtab-pane', 'style': 'display: none;' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('云端 Provider 子订阅源列表')),
					E('p', { 'style': 'margin-bottom: 12px;' },
						_('管理所有外部节点池子订阅。仅提取服务器节点注入本地，绝不覆盖本地任何规则。')
					),
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse; margin-bottom: 16px;' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'style': 'width: 140px;' }, _('Provider 标识')),
								E('th', { 'style': 'width: 90px;' }, _('节点前缀')),
								E('th', {}, _('订阅文件 URL (支持直接编辑)')),
								E('th', { 'style': 'width: 90px; text-align: center;' }, _('更新周期(秒)')),
								E('th', { 'style': 'width: 70px; text-align: center;' }, _('操作'))
							])
						]),
						E('tbody', { 'id': 'omniclash_providers_tbody' })
					]),
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-action',
						'click': function() { addProvider(); }
					}, _('+ 添加新 Provider'))
				])
			]),

			// 子 Tab 3: 分流节点组 (真实数据绑定 + 增删改查 + 恢复默认)
			E('div', { 'id': 'pane_groups', 'class': 'subtab-pane', 'style': 'display: none;' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' }, [
						E('div', {}, [
							E('h3', { 'style': 'margin: 0;' }, _('结构化分流策略组全景')),
							E('p', { 'style': 'margin: 4px 0 0 0; color: #94a3b8;' },
								_('预置模板中的全套 42 个策略组（专线组、地区组、应用分流组）。支持直接编辑、增删与恢复默认。')
							)
						]),
						E('div', {}, [
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-action',
								'style': 'margin-right: 6px;',
								'click': function() { addGroup(); }
							}, _('+ 添加新策略组')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-reset',
								'click': function() { resetDefaultGroups(); }
							}, _('🔄 恢复默认策略组'))
						])
					]),
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse;' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'style': 'width: 40px;' }, '#'),
								E('th', { 'style': 'width: 180px;' }, _('策略组名称')),
								E('th', { 'style': 'width: 120px;' }, _('组类型')),
								E('th', { 'style': 'width: 220px;' }, _('节点筛选正则 (Filter)')),
								E('th', { 'style': 'width: 150px;' }, _('引用 Provider')),
								E('th', { 'style': 'width: 70px; text-align: center;' }, _('操作'))
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
							E('h3', { 'style': 'margin: 0;' }, _('全量分流规则表 (Rule)')),
							E('p', { 'style': 'margin: 4px 0 0 0; color: #94a3b8;' },
								_('预置全套 69+ 规则库。支持直接修改匹配条件与走向策略组，支持上移/下移调整优先级。')
							)
						]),
						E('div', {}, [
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-action',
								'style': 'margin-right: 6px;',
								'click': function() { addRule(); }
							}, _('+ 添加新规则')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-reset',
								'click': function() { resetDefaultRules(); }
							}, _('🔄 恢复默认规则库'))
						])
					]),
					E('table', { 'class': 'table', 'style': 'width: 100%; border-collapse: collapse; margin-bottom: 12px;' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'style': 'width: 40px; text-align: center;' }, '#'),
								E('th', { 'style': 'width: 140px;' }, _('规则类型')),
								E('th', {}, _('匹配条件 (域名 / IP段 / GeoTag)')),
								E('th', { 'style': 'width: 180px;' }, _('走向 (策略组/直连/拦截)')),
								E('th', { 'style': 'width: 80px; text-align: center;' }, _('不解析IP')),
								E('th', { 'style': 'width: 120px; text-align: center;' }, _('操作'))
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
							E('h3', { 'style': 'margin: 0;' }, _('最终合流运行配置 (/etc/omniclash/run/config.yaml)')),
							E('div', { 'style': 'font-size: 12px; color: #94a3b8; margin-top: 4px;' },
								_('由【基础设置 + 节点池 + 策略组 + 分流规则 + 32-WiFi 矩阵】动态合流编译生成，只读展示。')
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
										ui.addNotification(null, E('p', {}, _('✅ 已刷新最新运行配置！')), 'success');
									});
								}
							}, _('🔄 刷新配置')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-neutral',
								'click': function() {
									var el = document.getElementById('omniclash_runconfig_area');
									if (el && navigator.clipboard) {
										navigator.clipboard.writeText(el.value).then(function() {
											ui.addNotification(null, E('p', {}, _('✅ 运行配置已复制到剪贴板！')), 'success');
										});
									}
								}
							}, _('📋 复制全部'))
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
				}, _('保存并应用')),
				E('span', {}, ' '),
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-reset',
					'click': function() { window.location.reload(); }
				}, _('重置'))
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
