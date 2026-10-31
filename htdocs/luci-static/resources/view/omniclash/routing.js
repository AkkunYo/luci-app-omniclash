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

var callUpdateProviders = rpc.declare({
	object: 'luci.omniclash',
	method: 'update_providers'
});

var callExportBackup = rpc.declare({
	object: 'luci.omniclash',
	method: 'export_backup'
});

var callImportBackup = rpc.declare({
	object: 'luci.omniclash',
	method: 'import_backup',
	params: [ 'backup' ]
});

function ensureRpcOk(res, fallbackMsg) {
	if (res && res.success === false)
		throw new Error(res.error || fallbackMsg || _('Operation failed'));
	return res;
}

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
		var appRuleTypes = ['DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN', 'IP-CIDR', 'GEOSITE', 'GEOIP', 'RULE-SET'];
		var appExpanded = {};
		var appBatchOpen = {};
		var groupFilterCat = 'all';
		var groupSearchQuery = '';
		var appSearchQuery = '';

		// 获取当前所有可选走向选项 (DIRECT, REJECT, 以及 groupsList 中的所有策略组名称)
		function getTargetOptions() {
			var targets = ['DIRECT', 'REJECT'];
			groupsList.forEach(function(g) {
				if (g.name && !targets.includes(g.name)) targets.push(g.name);
			});
			return targets;
		}

		// 若已存储的走向在当前策略组中已不存在，仍将其注入选项首位，
		// 避免下拉框静默回落到首个选项、进而在保存时改写掉用户原有配置
		function targetOptionsWith(cur) {
			var targets = getTargetOptions();
			if (cur && targets.indexOf(cur) < 0) targets.unshift(cur);
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

		window.updateAllSubscriptionsNow = function() {
			var btn = document.getElementById('btn_update_providers');
			if (btn) { btn.disabled = true; btn.innerText = _('Updating...'); }
			ui.showModal(_('Updating Subscriptions'), [
				E('p', { 'class': 'spinning' }, _('Fetching latest node pools from all subscription providers...'))
			]);

			callUpdateProviders().then(function(res) {
				if (btn) { btn.disabled = false; btn.innerText = '🔄 ' + _('Update All Subscriptions Now'); }
				ui.hideModal();
				ensureRpcOk(res, _('Failed to update subscriptions'));
				ui.addNotification(null, E('p', {}, '✅ ' + (res.msg || _('All subscriptions updated successfully!'))), 'success');
			}).catch(function(err) {
				if (btn) { btn.disabled = false; btn.innerText = '🔄 ' + _('Update All Subscriptions Now'); }
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		window.exportOmniBackup = function() {
			ui.showModal(_('Exporting Backup'), [
				E('p', { 'class': 'spinning' }, _('Packaging system configuration, slots, groups, and application cards...'))
			]);

			callExportBackup().then(function(res) {
				ui.hideModal();
				ensureRpcOk(res, _('Failed to export backup'));
				var b = res.backup || {};
				var jsonStr = JSON.stringify(b, null, 2);
				var blob = new Blob([jsonStr], { type: 'application/json' });
				var url = URL.createObjectURL(blob);
				var a = document.createElement('a');
				var dateStr = (new Date()).toISOString().slice(0, 10);
				a.href = url;
				a.download = 'omniclash-backup-' + dateStr + '.json';
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
				ui.addNotification(null, E('p', {}, '✅ ' + _('Configuration backup exported successfully!')), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		window.handleBackupFileSelect = function(ev) {
			var file = ev.target.files ? ev.target.files[0] : null;
			if (!file) return;

			var reader = new FileReader();
			reader.onload = function(e) {
				var content = e.target.result;
				var parsed = null;
				try { parsed = JSON.parse(content); } catch (err) {
					ui.addNotification(null, E('p', {}, _('Invalid backup file: not valid JSON')), 'error');
					return;
				}

				if (!parsed || parsed.app !== 'omniclash' || !parsed.data) {
					ui.addNotification(null, E('p', {}, _('Invalid backup file: not an OmniClash backup archive')), 'error');
					return;
				}

				var dateStr = parsed.exported_at ? (new Date(parsed.exported_at * 1000)).toLocaleString() : _('Unknown Date');
				var hostStr = parsed.hostname || '-';

				if (!confirm(_('Are you sure you want to restore this configuration?\nExported at: %s from %s\nAll current slots, proxy groups, and application cards will be overwritten.').replace('%s', dateStr).replace('%s', hostStr))) {
					ev.target.value = '';
					return;
				}

				ui.showModal(_('Restoring Configuration'), [
					E('p', { 'class': 'spinning' }, _('Restoring configuration files, recompiling rules, and seamlessly reloading...'))
				]);

				callImportBackup(parsed).then(function(res) {
					ui.hideModal();
					ensureRpcOk(res, _('Failed to restore configuration'));
					ui.addNotification(null, E('p', {}, '✅ ' + (res.msg || _('Configuration successfully restored and recompiled!'))), 'success');
					setTimeout(function() { window.location.reload(); }, 1200);
				}).catch(function(err) {
					ui.hideModal();
					ui.addNotification(null, E('p', {}, err.message), 'error');
				});
			};
			reader.readAsText(file);
			ev.target.value = '';
		};

		// ---------------- 2. Proxy Groups 策略组现代卡片流与全功能装配 ----------------
		function detectGroupCat(g) {
			var n = (g && g.name) ? g.name : "";
			if (n.indexOf("专线") >= 0) return "line";
			if (g && (g.type === "url-test" || n.indexOf("节点") >= 0 || n.indexOf("地区") >= 0 || /香港|台湾|日本|新加坡|韩国|美国|英国|德国|其它/.test(n))) return "region";
			if (n.indexOf("选择") >= 0 || n.indexOf("负载") >= 0 || n.indexOf("全部") >= 0 || n.indexOf("前置") >= 0 || n.indexOf("住宅") >= 0 || n.indexOf("漏网") >= 0) return "core";
			return "app";
		}

		function groupTypeBadge(type) {
			var style = "padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; font-family: monospace; display: inline-flex; align-items: center; gap: 4px;";
			if (type === "select") {
				return E("span", { "style": style + " background: rgba(37, 99, 235, 0.12); color: #2563eb; border: 1px solid rgba(37, 99, 235, 0.28);" }, "select");
			} else if (type === "url-test") {
				return E("span", { "style": style + " background: rgba(16, 185, 129, 0.12); color: #059669; border: 1px solid rgba(16, 185, 129, 0.28);" }, "url-test ⚡");
			} else if (type === "fallback") {
				return E("span", { "style": style + " background: rgba(245, 158, 11, 0.12); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.28);" }, "fallback");
			} else if (type === "load-balance") {
				return E("span", { "style": style + " background: rgba(139, 92, 246, 0.12); color: #7c3aed; border: 1px solid rgba(139, 92, 246, 0.28);" }, "load-balance ☢");
			}
			return E("span", { "style": style + " background: rgba(148, 163, 184, 0.15); color: #64748b;" }, type || "unknown");
		}

		window.openGroupModal = function(idx) {
			var isNew = (idx < 0);
			var group = isNew ? {
				name: "",
				type: "select",
				filter: "",
				proxies: ["DIRECT"],
				strategy: "consistent-hashing",
				tolerance: 50,
				interval: 300,
				lazy: true
			} : JSON.parse(JSON.stringify(groupsList[idx]));

			var nameInput = E("input", {
				"type": "text",
				"class": "cbi-input-text",
				"style": "width: 100%; box-sizing: border-box; font-weight: 600; font-size: 13px; color: #2563eb;",
				"value": group.name || "",
				"placeholder": _("e.g. 🎯 专线-Tallflix")
			});

			var typeSelect = E("select", {
				"class": "cbi-input-select",
				"style": "width: 100%; box-sizing: border-box; font-size: 13px;"
			}, groupTypes.map(function(t) {
				return E("option", { "value": t, "selected": t === group.type ? "selected" : null }, t);
			}));

			var iconInput = E("input", {
				"type": "text",
				"class": "cbi-input-text",
				"style": "width: 100%; box-sizing: border-box; font-size: 12px;",
				"value": group.icon || "",
				"placeholder": "https://... or emoji"
			});

			var filterInput = E("input", {
				"type": "text",
				"class": "cbi-input-text",
				"style": "width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px;",
				"value": group.filter || "",
				"placeholder": "e.g. (?i)HK|HongKong"
			});

			var urlInput = E("input", {
				"type": "text",
				"class": "cbi-input-text",
				"style": "width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px;",
				"value": group.url || "https://www.gstatic.com/generate_204",
				"placeholder": "https://www.gstatic.com/generate_204"
			});

			var intervalInput = E("input", {
				"type": "number",
				"class": "cbi-input-text",
				"style": "width: 100%; box-sizing: border-box;",
				"value": group.interval || 300
			});

			var toleranceInput = E("input", {
				"type": "number",
				"class": "cbi-input-text",
				"style": "width: 100%; box-sizing: border-box;",
				"value": group.tolerance || 50
			});

			var strategySelect = E("select", {
				"class": "cbi-input-select",
				"style": "width: 100%; box-sizing: border-box;"
			}, [
				E("option", { "value": "consistent-hashing", "selected": group.strategy === "consistent-hashing" ? "selected" : null }, "consistent-hashing (" + _("Consistent Hashing") + ")"),
				E("option", { "value": "round-robin", "selected": group.strategy === "round-robin" ? "selected" : null }, "round-robin (" + _("Round Robin") + ")")
			]);

			var lazyCheckbox = E("input", {
				"type": "checkbox",
				"checked": (group.lazy !== false) ? "checked" : null
			});

			var candidateTargets = ["DIRECT", "REJECT"];
			groupsList.forEach(function(g, gidx) {
				if (!isNew && gidx === idx) return;
				if (g.name && candidateTargets.indexOf(g.name) < 0) {
					candidateTargets.push(g.name);
				}
			});

			var selectedProxies = (group.proxies && Array.isArray(group.proxies)) ? group.proxies.slice() : [];
			var pillsContainer = E("div", {
				"style": "display: flex; flex-wrap: wrap; gap: 6px; max-height: 160px; overflow-y: auto; padding: 8px 10px; border: 1px solid rgba(148,163,184,0.25); border-radius: 6px; background: rgba(0,0,0,0.02);"
			});

			function renderPills() {
				pillsContainer.innerHTML = "";
				candidateTargets.forEach(function(tgt) {
					var isSel = (selectedProxies.indexOf(tgt) >= 0);
					var pill = E("span", {
						"style": "display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; user-select: none; transition: all 0.15s ease;" +
							(isSel ? " background: #2563eb; color: #fff; font-weight: 500;" : " background: rgba(148,163,184,0.15); color: #475569;"),
						"click": function() {
							var pos = selectedProxies.indexOf(tgt);
							if (pos >= 0) selectedProxies.splice(pos, 1);
							else selectedProxies.push(tgt);
							renderPills();
						}
					}, [ isSel ? "✓ " + tgt : "+ " + tgt ]);
					pillsContainer.appendChild(pill);
				});
			}
			renderPills();

			var testSection = E("div", {
				"id": "grp_test_section",
				"style": "margin-bottom: 14px; padding: 10px 12px; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 6px;"
			}, [
				E("div", { "style": "font-weight: 600; font-size: 12px; color: #059669; margin-bottom: 8px;" }, "⚡ " + _("Auto Speedtest Settings")),
				E("div", { "style": "display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px;" }, [
					E("div", {}, [ E("label", { "style": "display: block; font-size: 11px; color: #64748b; margin-bottom: 3px;" }, _("Interval (sec)")), intervalInput ]),
					E("div", {}, [ E("label", { "style": "display: block; font-size: 11px; color: #64748b; margin-bottom: 3px;" }, _("Tolerance (ms)")), toleranceInput ])
				]),
				E("div", { "style": "margin-bottom: 8px;" }, [
					E("label", { "style": "display: block; font-size: 11px; color: #64748b; margin-bottom: 3px;" }, _("Health Check URL")),
					urlInput
				]),
				E("div", { "style": "display: flex; align-items: center; gap: 6px; font-size: 12px; color: #475569;" }, [
					lazyCheckbox, _("Lazy Test (test only when traffic is routed)")
				])
			]);

			var lbSection = E("div", {
				"id": "grp_lb_section",
				"style": "margin-bottom: 14px; padding: 10px 12px; background: rgba(124, 58, 237, 0.05); border: 1px solid rgba(124, 58, 237, 0.2); border-radius: 6px;"
			}, [
				E("div", { "style": "font-weight: 600; font-size: 12px; color: #7c3aed; margin-bottom: 8px;" }, "☢ " + _("Load Balance Algorithm")),
				strategySelect
			]);

			function syncTypeView() {
				var t = typeSelect.value;
				testSection.style.display = (t === "url-test" || t === "fallback") ? "block" : "none";
				lbSection.style.display = (t === "load-balance") ? "block" : "none";
			}
			typeSelect.addEventListener("change", syncTypeView);
			syncTypeView();

			var modalBody = E("div", { "style": "width: 100%; box-sizing: border-box; padding: 4px 0;" }, [
				E("div", { "style": "display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 12px;" }, [
					E("div", {}, [
						E("label", { "style": "display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #1e293b;" }, _("Group Name")),
						nameInput
					]),
					E("div", {}, [
						E("label", { "style": "display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #1e293b;" }, _("Group Type")),
						typeSelect
					])
				]),
				E("div", { "style": "margin-bottom: 12px;" }, [
					E("label", { "style": "display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #1e293b;" }, _("Node Filter (Regex)")),
					filterInput,
					E("div", { "style": "display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;" }, [
						E("span", { "style": "font-size: 11px; color: #64748b;" }, _("Quick tags:")),
						E("a", { "href": "#", "style": "font-size: 11px; color: #2563eb;", "click": function(e){ e.preventDefault(); filterInput.value = "(?i)HK|香港"; } }, "香港 (HK)"),
						E("a", { "href": "#", "style": "font-size: 11px; color: #2563eb;", "click": function(e){ e.preventDefault(); filterInput.value = "(?i)TW|台湾"; } }, "台湾 (TW)"),
						E("a", { "href": "#", "style": "font-size: 11px; color: #2563eb;", "click": function(e){ e.preventDefault(); filterInput.value = "(?i)JP|日本"; } }, "日本 (JP)"),
						E("a", { "href": "#", "style": "font-size: 11px; color: #2563eb;", "click": function(e){ e.preventDefault(); filterInput.value = "(?i)SG|新加坡"; } }, "新加坡 (SG)"),
						E("a", { "href": "#", "style": "font-size: 11px; color: #2563eb;", "click": function(e){ e.preventDefault(); filterInput.value = "(?i)US|美国"; } }, "美国 (US)")
					])
				]),
				testSection,
				lbSection,
				E("div", { "style": "margin-bottom: 14px;" }, [
					E("div", { "style": "display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;" }, [
						E("label", { "style": "font-weight: 600; font-size: 13px; margin: 0; color: #1e293b;" }, _("Child Proxies / Sub-Groups")),
						E("span", { "style": "font-size: 11px; color: #64748b;" }, _("Click pills to toggle"))
					]),
					pillsContainer
				]),
				E("div", { "style": "margin-bottom: 12px;" }, [
					E("label", { "style": "display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #1e293b;" }, _("Group Icon URL")),
					iconInput
				]),
				E("div", { "class": "right", "style": "display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;" }, [
					E("button", { "type": "button", "class": "cbi-button", "click": ui.hideModal }, _("Cancel")),
					E("button", {
						"type": "button",
						"class": "cbi-button cbi-button-apply",
						"click": function() {
							var newName = (nameInput.value || "").trim();
							if (!newName) {
								ui.addNotification(null, E("p", {}, _("Group name cannot be empty!")), "error");
								return;
							}
							var newG = {
								name: newName,
								type: typeSelect.value,
								filter: (filterInput.value || "").trim(),
								proxies: selectedProxies,
								icon: (iconInput.value || "").trim()
							};
							if (newG.type === "url-test" || newG.type === "fallback") {
								newG.url = (urlInput.value || "").trim();
								newG.interval = parseInt(intervalInput.value, 10) || 300;
								newG.tolerance = parseInt(toleranceInput.value, 10) || 50;
								newG.lazy = lazyCheckbox.checked;
							} else if (newG.type === "load-balance") {
								newG.strategy = strategySelect.value;
							}
							if (isNew) {
								groupsList.push(newG);
							} else {
								groupsList[idx] = newG;
							}
							ui.hideModal();
							renderGroupCards();
						}
					}, _("Save"))
				])
			]);

			ui.showModal(isNew ? _("New Proxy Group") : _("Edit Proxy Group"), modalBody);
		};

		window.moveGroup = function(idx, offset) {
			var target = idx + offset;
			if (target < 0 || target >= groupsList.length) return;
			var tmp = groupsList[idx];
			groupsList[idx] = groupsList[target];
			groupsList[target] = tmp;
			renderGroupCards();
		};

		window.removeGroup = function(idx) {
			var g = groupsList[idx];
			if (!g) return;
			if (!confirm(_("Are you sure you want to delete proxy group \"%s\"?").replace("%s", g.name))) return;
			groupsList.splice(idx, 1);
			renderGroupCards();
		};

		function renderGroupCards() {
			var container = document.getElementById("omniclash_groups_container");
			if (!container) return;
			container.innerHTML = "";

			var catCounts = { all: groupsList.length, line: 0, region: 0, app: 0, core: 0 };
			groupsList.forEach(function(g) {
				var c = detectGroupCat(g);
				if (catCounts[c] !== undefined) catCounts[c]++;
			});

			var catBar = E("div", {
				"style": "display: flex; gap: 8px; align-items: center; margin-bottom: 14px; flex-wrap: wrap;"
			}, [
				E("button", {
					"type": "button",
					"class": "cbi-button" + (groupFilterCat === "all" ? " cbi-button-action" : ""),
					"style": "font-size: 12px; padding: 3px 10px;" + (groupFilterCat === "all" ? " font-weight: bold;" : ""),
					"click": function() { groupFilterCat = "all"; renderGroupCards(); }
				}, _("All") + " (" + catCounts.all + ")"),
				E("button", {
					"type": "button",
					"class": "cbi-button" + (groupFilterCat === "line" ? " cbi-button-action" : ""),
					"style": "font-size: 12px; padding: 3px 10px;" + (groupFilterCat === "line" ? " font-weight: bold;" : ""),
					"click": function() { groupFilterCat = "line"; renderGroupCards(); }
				}, "🎯 " + _("Dedicated Lines") + " (" + catCounts.line + ")"),
				E("button", {
					"type": "button",
					"class": "cbi-button" + (groupFilterCat === "region" ? " cbi-button-action" : ""),
					"style": "font-size: 12px; padding: 3px 10px;" + (groupFilterCat === "region" ? " font-weight: bold;" : ""),
					"click": function() { groupFilterCat = "region"; renderGroupCards(); }
				}, "🌐 " + _("Region Auto") + " (" + catCounts.region + ")"),
				E("button", {
					"type": "button",
					"class": "cbi-button" + (groupFilterCat === "app" ? " cbi-button-action" : ""),
					"style": "font-size: 12px; padding: 3px 10px;" + (groupFilterCat === "app" ? " font-weight: bold;" : ""),
					"click": function() { groupFilterCat = "app"; renderGroupCards(); }
				}, "🎛️ " + _("App Routing") + " (" + catCounts.app + ")"),
				E("button", {
					"type": "button",
					"class": "cbi-button" + (groupFilterCat === "core" ? " cbi-button-action" : ""),
					"style": "font-size: 12px; padding: 3px 10px;" + (groupFilterCat === "core" ? " font-weight: bold;" : ""),
					"click": function() { groupFilterCat = "core"; renderGroupCards(); }
				}, "🚀 " + _("Core Dispatch") + " (" + catCounts.core + ")")
			]);
			container.appendChild(catBar);

			var searchInput = E("input", {
				"type": "text",
				"class": "cbi-input-text",
				"style": "flex: 1; min-width: 220px; font-size: 12px;",
				"placeholder": _("🔍 Search proxy group name, regex filter, or type..."),
				"value": groupSearchQuery
			});
			searchInput.addEventListener("input", function() {
				groupSearchQuery = (this.value || "").trim();
				renderGroupListOnly();
			});

			var topActionBar = E("div", {
				"style": "display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap;"
			}, [
				searchInput,
				E("div", { "style": "display: flex; gap: 8px;" }, [
					E("button", {
						"type": "button",
						"class": "cbi-button cbi-button-action",
						"click": function() { window.openGroupModal(-1); }
					}, "+ " + _("New Proxy Group")),
					E("button", {
						"type": "button",
						"class": "cbi-button cbi-button-reset",
						"click": function() { window.resetDefaultGroups(); }
					}, "🔄 " + _("Reset to Default Groups"))
				])
			]);
			container.appendChild(topActionBar);

			var listContainer = E("div", { "id": "omniclash_groups_list_inner" });
			container.appendChild(listContainer);

			function renderGroupListOnly() {
				listContainer.innerHTML = "";
				var filtered = [];
				groupsList.forEach(function(g, idx) {
					if (groupFilterCat !== "all" && detectGroupCat(g) !== groupFilterCat) return;
					if (groupSearchQuery) {
						var q = groupSearchQuery.toLowerCase();
						var nm = (g.name || "").toLowerCase();
						var fl = (g.filter || "").toLowerCase();
						var tp = (g.type || "").toLowerCase();
						if (nm.indexOf(q) < 0 && fl.indexOf(q) < 0 && tp.indexOf(q) < 0) return;
					}
					filtered.push({ g: g, idx: idx });
				});

				if (!filtered.length) {
					listContainer.appendChild(E("div", {
						"style": "text-align: center; padding: 30px; color: #94a3b8; font-size: 13px; background: rgba(0,0,0,0.02); border-radius: 8px; border: 1px dashed rgba(148,163,184,0.25);"
					}, _("No proxy groups match current filter or search.")));
					return;
				}

				filtered.forEach(function(item) {
					var g = item.g;
					var idx = item.idx;

					var iconEl = null;
					if (g.icon && g.icon.indexOf("http") === 0) {
						iconEl = E("img", { "src": g.icon, "style": "width: 22px; height: 22px; object-fit: contain; vertical-align: middle; flex-shrink: 0;" });
					} else {
						var emoji = "🌐";
						if (g.name.indexOf("专线") >= 0) emoji = "🎯";
						else if (g.name.indexOf("自动") >= 0 || g.type === "url-test") emoji = "⚡";
						else if (g.name.indexOf("负载") >= 0) emoji = "☢";
						else if (g.name.indexOf("选择") >= 0) emoji = "🚀";
						else if (g.name.indexOf("直连") >= 0) emoji = "🟢";
						iconEl = E("span", { "style": "font-size: 18px; vertical-align: middle; flex-shrink: 0;" }, emoji);
					}

					var badge = groupTypeBadge(g.type);

					var detailParts = [];
					if (g.filter) {
						detailParts.push(E("span", {
							"style": "padding: 1px 6px; border-radius: 4px; background: rgba(148,163,184,0.12); color: #475569; font-family: monospace; font-size: 11px;"
						}, "filter: " + g.filter));
					}
					if (g.proxies && g.proxies.length) {
						var preview = g.proxies.slice(0, 3).join(", ") + (g.proxies.length > 3 ? "..." : "");
						detailParts.push(E("span", {
							"style": "padding: 1px 6px; border-radius: 4px; background: rgba(37,99,235,0.08); color: #2563eb; font-size: 11px;"
						}, _("Proxies") + ": [" + preview + "] (" + g.proxies.length + ")"));
					}
					if (g.type === "url-test" || g.type === "fallback") {
						detailParts.push(E("span", {
							"style": "padding: 1px 6px; border-radius: 4px; background: rgba(16,185,129,0.08); color: #059669; font-size: 11px;"
						}, (g.interval || 300) + "s / " + (g.tolerance || 50) + "ms"));
					}
					if (g.strategy) {
						detailParts.push(E("span", {
							"style": "padding: 1px 6px; border-radius: 4px; background: rgba(139,92,246,0.08); color: #7c3aed; font-size: 11px;"
						}, g.strategy));
					}

					var card = E("div", {
						"style": "display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; margin-bottom: 8px; border: 1px solid rgba(148,163,184,0.22); border-radius: 8px; background: rgba(255,255,255,0.03); transition: all 0.2s ease; flex-wrap: wrap;"
					}, [
						E("div", { "style": "display: flex; align-items: center; gap: 10px; min-width: 240px; flex: 1;" }, [
							E("span", { "style": "font-family: monospace; font-size: 11px; color: #94a3b8; font-weight: bold; width: 28px;" }, "#" + (idx + 1 < 10 ? "0" : "") + (idx + 1)),
							iconEl,
							E("div", {}, [
								E("div", { "style": "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;" }, [
									E("b", { "style": "font-size: 13px; color: #1e293b;" }, g.name),
									badge
								]),
								E("div", { "style": "display: flex; gap: 6px; align-items: center; margin-top: 4px; flex-wrap: wrap;" }, detailParts)
							])
						]),
						E("div", { "style": "display: flex; align-items: center; gap: 6px; flex-shrink: 0;" }, [
							E("button", {
								"type": "button",
								"class": "cbi-button",
								"style": "padding: 2px 8px; font-size: 12px;",
								"click": function() { window.openGroupModal(idx); }
							}, "⚙️ " + _("Edit")),
							E("button", {
								"type": "button",
								"class": "cbi-button",
								"style": "padding: 2px 8px; font-size: 12px;",
								"disabled": (idx === 0) ? "disabled" : null,
								"click": function() { window.moveGroup(idx, -1); }
							}, "↑"),
							E("button", {
								"type": "button",
								"class": "cbi-button",
								"style": "padding: 2px 8px; font-size: 12px;",
								"disabled": (idx === groupsList.length - 1) ? "disabled" : null,
								"click": function() { window.moveGroup(idx, 1); }
							}, "↓"),
							E("button", {
								"type": "button",
								"class": "cbi-button cbi-button-remove",
								"style": "padding: 2px 8px; font-size: 12px;",
								"click": function() { window.removeGroup(idx); }
							}, _("Delete"))
						])
					]);
					listContainer.appendChild(card);
				});
			}

		renderGroupListOnly();
		}

		window.resetDefaultGroups = function() {
			if (!confirm(_("Are you sure you want to reset proxy groups to default template?\nThis will reset all dedicated lines, regions, and application groups."))) return;
			ui.showModal(_("Resetting"), [ E("p", { "class": "spinning" }, _("Resetting default proxy groups template...")) ]);
			callResetGroups().then(function(res) {
				if (res && res.success === false)
					throw new Error(res.error || _("Failed to reset proxy groups"));
				return callGetGroups();
			}).then(function(res) {
				groupsList = (res && res.groups) ? res.groups : [];
				renderGroupCards();
				ui.hideModal();
				ui.addNotification(null, E("p", {}, "✅ " + _("Proxy groups successfully restored to default template!")), "success");
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E("p", {}, err.message), "error");
			});
		};

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

		window.expandAllApps = function(expandState) {
			appsList.forEach(function(a) {
				if (a && a.id) appExpanded[a.id] = !!expandState;
			});
			renderAppCards();
		};

		window.toggleBatchBox = function(idx) {
			appBatchOpen[idx] = !appBatchOpen[idx];
			renderAppCards();
		};

		window.addBatchCustomRules = function(idx) {
			var textarea = document.getElementById("app_batch_text_" + idx);
			var typeSelect = document.getElementById("app_batch_type_" + idx);
			if (!textarea || !typeSelect) return;
			var text = (textarea.value || "").trim();
			if (!text) {
				ui.addNotification(null, E("p", {}, _("Please paste domains or IPs first.")), "error");
				return;
			}
			var lines = text.split("\n");
			var added = 0;
			if (!appsList[idx].custom_rules) appsList[idx].custom_rules = [];
			var defaultType = typeSelect.value;

			lines.forEach(function(line) {
				var raw = line.trim();
				if (!raw || raw.startsWith("#") || raw.startsWith("//")) return;
				var parts = raw.split(/[,:\s]+/);
				var t = defaultType;
				var p = raw;
				if (parts.length >= 2 && appRuleTypes.indexOf(parts[0].toUpperCase()) >= 0) {
					t = parts[0].toUpperCase();
					p = parts[1];
				}
				appsList[idx].custom_rules.push({ type: t, payload: p });
				added++;
			});

			appBatchOpen[idx] = false;
			renderAppCards();
			ui.addNotification(null, E("p", {}, "✅ " + _("Imported %d rules into \"%s\"!").replace("%d", added).replace("%s", appsList[idx].name || appsList[idx].id)), "success");
		};

		function renderAppCards() {
			var container = document.getElementById("omniclash_apps_container");
			if (!container) return;
			container.innerHTML = "";

			if (appsList.length === 0) {
				container.appendChild(E("div", {
					"style": "text-align: center; padding: 24px; color: #94a3b8; font-size: 13px;"
				}, _('No application scenarios configured. Use "+ New Scenario Card" or "Reset to Defaults".')));
				return;
			}

			appsList.forEach(function(app, idx) {
				if (appSearchQuery) {
					var q = appSearchQuery.toLowerCase();
					var matchName = (app.name && app.name.toLowerCase().indexOf(q) >= 0);
					var matchId = (app.id && app.id.toLowerCase().indexOf(q) >= 0);
					var matchRule = false;
					var allR = (app.builtin_rules || []).concat(app.custom_rules || []);
					for (var i = 0; i < allR.length; i++) {
						if (allR[i] && allR[i].payload && allR[i].payload.toLowerCase().indexOf(q) >= 0) {
							matchRule = true;
							break;
						}
					}
					if (!matchName && !matchId && !matchRule) return;
				}

				var expanded = !!appExpanded[app.id];
				var enabled = (app.enabled === false || app.enabled === "false" || app.enabled === "0" || app.enabled === 0) ? false : true;
				var isBuiltin = (app.is_custom !== true);
				var count = appRuleCount(app);

				var targetSel = E("select", {
					"class": "cbi-input-select",
					"style": "width: 210px; font-size: 12px;",
					"change": function() {
						appsList[idx].target = this.value;
					}
				}, targetOptionsWith(app.target).map(function(t) {
					return E("option", { "value": t, "selected": (app.target === t) ? "selected" : null }, t);
				}));

				var enabledBox = E("input", {
					"type": "checkbox",
					"title": _("Enable this scenario"),
					"checked": enabled ? "checked" : null,
					"style": "cursor: pointer;",
					"change": function() {
						appsList[idx].enabled = this.checked;
						renderAppCards();
					}
				});

				var rowHeader = E("div", {
					"style": "display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 14px;" + (enabled ? "" : " opacity: 0.55;")
				}, [
					E("button", {
						"type": "button",
						"class": "cbi-button",
						"style": "padding: 0 6px; min-width: 24px; font-size: 12px;",
						"title": expanded ? _("Collapse") : _("Expand"),
						"click": function() {
							appExpanded[app.id] = !expanded;
							renderAppCards();
						}
					}, expanded ? "▾" : "▸"),
					E("span", { "style": "font-weight: 600; font-size: 13px; min-width: 120px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1e293b;" }, app.name || app.id),
					E("span", {
						"class": "badge",
						"style": "padding: 2px 8px; border-radius: 10px; font-size: 11px; background: rgba(37,99,235,0.08); color: #2563eb; font-weight: 500;"
					}, _("%d rules").format(count)),
					E("span", { "style": "flex: 1;" }),
					E("span", { "style": "font-size: 12px; color: #64748b;" }, _("Egress")),
					targetSel,
					E("span", { "style": "display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #64748b;" }, [ enabledBox, _("On") ]),
					E("button", {
						"type": "button",
						"class": "cbi-button",
						"style": "padding: 0 6px; min-width: 24px;",
						"disabled": idx === 0 ? "disabled" : null,
						"title": _("Move Up"),
						"click": function() { window.moveApp(idx, -1); }
					}, "↑"),
					E("button", {
						"type": "button",
						"class": "cbi-button",
						"style": "padding: 0 6px; min-width: 24px;",
						"disabled": idx === appsList.length - 1 ? "disabled" : null,
						"title": _("Move Down"),
						"click": function() { window.moveApp(idx, 1); }
					}, "↓"),
					isBuiltin ? "" : E("button", {
						"type": "button",
						"class": "cbi-button cbi-button-remove",
						"style": "padding: 0 6px; min-width: 24px;",
						"title": _("Delete custom scenario"),
						"click": function() { window.removeApp(idx); }
					}, "✕")
				]);

				var cardChildren = [ rowHeader ];

			if (expanded) {
					var bodyChildren = [];
					if (app.desc) {
						bodyChildren.push(E("div", { "style": "font-size: 12px; color: #64748b; margin-bottom: 8px;" }, app.desc));
					}

					bodyChildren.push(E("div", { "style": "font-size: 11px; font-weight: bold; color: #64748b; margin-bottom: 4px;" }, _("Built-in Rules:")));
					if (app.builtin_rules && app.builtin_rules.length) {
						bodyChildren.push(E("div", {
							"style": "display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; max-height: 120px; overflow-y: auto;"
						}, app.builtin_rules.map(function(r) {
							return E("span", {
								"style": "display: inline-flex; align-items: center; gap: 4px; font-family: monospace; font-size: 11px; padding: 2px 6px; border-radius: 3px; background: rgba(148,163,184,0.12); color: #334155;"
							}, [
								E("span", { "style": "font-weight: bold; color: #64748b;" }, r.type),
								r.payload
							]);
						})));
					} else {
						bodyChildren.push(E("div", { "style": "font-size: 11px; color: #94a3b8; margin-bottom: 8px;" }, _("No built-in rules (pure target-binding card).")));
					}

					bodyChildren.push(E("div", { "style": "font-size: 11px; font-weight: bold; color: #64748b; margin-bottom: 4px;" }, _("Custom Rules:")));
					if (app.custom_rules && app.custom_rules.length) {
						bodyChildren.push(E("div", {
							"style": "display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px;"
						}, app.custom_rules.map(function(r, ridx) {
							return E("span", {
								"style": "display: inline-flex; align-items: center; gap: 6px; font-family: monospace; font-size: 11px; padding: 2px 6px; border-radius: 3px; background: rgba(16,185,129,0.1); color: #059669; border: 1px solid rgba(16,185,129,0.25);"
							}, [
								E("b", {}, r.type),
								r.payload,
								E("button", {
									"type": "button",
									"class": "cbi-button cbi-button-remove",
									"style": "padding: 0 4px; font-size: 10px; height: 16px; line-height: 16px; margin: 0;",
									"click": function() { window.removeCustomRule(idx, ridx); }
								}, "×")
							]);
						})));
					} else {
						bodyChildren.push(E("div", { "style": "font-size: 11px; color: #94a3b8; margin-bottom: 8px;" }, _("No custom rules yet.")));
					}

					bodyChildren.push(E("div", { "style": "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;" }, [
						E("select", {
							"id": "app_newtype_" + idx,
							"class": "cbi-input-select",
							"style": "width: 150px; font-size: 12px;"
						}, appRuleTypes.map(function(t) {
							return E("option", { "value": t }, t);
						})),
						E("input", {
							"type": "text",
							"id": "app_newpayload_" + idx,
							"class": "cbi-input-text",
							"style": "width: 260px; font-family: monospace; font-size: 12px;",
							"placeholder": _("Domain or IP (e.g. example.com)")
						}),
						E("button", {
							"type": "button",
							"class": "cbi-button cbi-button-action",
							"style": "font-size: 12px;",
							"click": function() { window.addCustomRule(idx); }
						}, _("Add")),
						E("button", {
							"type": "button",
							"class": "cbi-button",
							"style": "font-size: 12px;",
							"click": function() { window.toggleBatchBox(idx); }
						}, "📋 " + (appBatchOpen[idx] ? _("Close Batch") : _("Batch Import")))
					]));

					if (appBatchOpen[idx]) {
						bodyChildren.push(E("div", {
							"style": "margin-top: 10px; padding: 10px; background: rgba(59,130,246,0.04); border: 1px dashed rgba(59,130,246,0.3); border-radius: 6px;"
						}, [
							E("div", { "style": "font-size: 12px; font-weight: 600; color: #2563eb; margin-bottom: 6px;" },
								_("Batch Rule Import (one domain or IP per line, supports lines like DOMAIN-SUFFIX,example.com):")),
							E("div", { "style": "display: flex; gap: 8px; margin-bottom: 8px;" }, [
								E("span", { "style": "font-size: 12px; line-height: 30px; color: #64748b;" }, _("Default Type:")),
								E("select", {
									"id": "app_batch_type_" + idx,
									"class": "cbi-input-select",
									"style": "width: 160px; font-size: 12px;"
								}, appRuleTypes.map(function(t) {
									return E("option", { "value": t }, t);
								}))
							]),
							E("textarea", {
								"id": "app_batch_text_" + idx,
								"class": "cbi-input-textarea",
								"style": "width: 100%; height: 90px; font-family: monospace; font-size: 12px; box-sizing: border-box; margin-bottom: 8px;",
								"placeholder": "example.com\n*.google.com\n1.2.3.4/24"
							}),
							E("button", {
								"type": "button",
								"class": "cbi-button cbi-button-action",
								"style": "font-size: 12px;",
								"click": function() { window.addBatchCustomRules(idx); }
							}, "⚡ " + _("Import All Lines"))
						]));
					}

					cardChildren.push(E("div", {
						"style": "padding: 0 14px 12px 46px; border-top: 1px dashed rgba(148,163,184,0.22); padding-top: 10px; margin-top: 2px;"
					}, bodyChildren));
				}

				container.appendChild(E("div", {
					"style": "border: 1px solid rgba(148,163,184,0.22); border-left: 4px solid " + (enabled ? "#3b82f6;" : "#94a3b8;") + " border-radius: 8px; margin-bottom: 10px; background: rgba(255,255,255,0.02); box-shadow: 0 1px 3px rgba(0,0,0,0.02);"
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
				ui.addNotification(null, E("p", {}, _("Built-in scenarios cannot be deleted. Disable them instead.")), "warning");
				return;
			}
			appsList.splice(idx, 1);
			delete appExpanded[app.id];
			renderAppCards();
		};

		window.addCustomRule = function(idx) {
			var typeEl = document.getElementById("app_newtype_" + idx);
			var payloadEl = document.getElementById("app_newpayload_" + idx);
			if (!typeEl || !payloadEl) return;
			var payload = (payloadEl.value || "").trim();
			if (!payload) {
				ui.addNotification(null, E("p", {}, _("Please enter a domain or IP first.")), "error");
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
			var nameInput = E("input", {
				"type": "text",
				"class": "cbi-input-text",
				"id": "new_app_name",
				"style": "width: 100%; box-sizing: border-box;",
				"placeholder": _("e.g. Company Office")
			});
			var typeSelect = E("select", {
				"class": "cbi-input-select",
				"id": "new_app_type",
				"style": "width: 100%; box-sizing: border-box;"
			}, appRuleTypes.map(function(t) {
				return E("option", { "value": t }, t);
			}));
			var payloadInput = E("input", {
				"type": "text",
				"class": "cbi-input-text",
				"id": "new_app_payload",
				"style": "width: 100%; box-sizing: border-box; font-family: monospace;",
				"placeholder": _("e.g. example.com")
			});
			var targetSelect = E("select", {
				"class": "cbi-input-select",
				"id": "new_app_target",
				"style": "width: 100%; box-sizing: border-box;"
			}, getTargetOptions().map(function(t) {
				return E("option", { "value": t, "selected": t === "🚀 节点选择" ? "selected" : null }, t);
			}));

			ui.showModal(_("New Scenario Card"), E("div", { "style": "width: 100%; box-sizing: border-box; padding: 4px 0;" }, [
				E("div", { "style": "margin-bottom: 14px;" }, [
					E("label", { "style": "display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #1e293b;" }, _("Scenario Name")),
					nameInput
				]),
				E("div", { "style": "margin-bottom: 14px;" }, [
					E("label", { "style": "display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #1e293b;" }, _("Rule Type")),
					typeSelect
				]),
				E("div", { "style": "margin-bottom: 14px;" }, [
					E("label", { "style": "display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #1e293b;" }, _("Initial Domain / IP")),
					payloadInput,
					E("div", { "style": "margin-top: 4px; font-size: 12px; color: #64748b;" }, _("Optional. Leave blank to create a card with only an egress target."))
				]),
				E("div", { "style": "margin-bottom: 16px;" }, [
					E("label", { "style": "display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #1e293b;" }, _("Egress Target")),
					targetSelect
				]),
				E("div", { "class": "right", "style": "margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px;" }, [
					E("button", { "type": "button", "class": "cbi-button", "click": ui.hideModal }, _("Cancel")),
					E("button", {
						"type": "button",
						"class": "cbi-button cbi-button-apply",
						"click": function() {
							var name = (nameInput.value || "").trim();
							if (!name) {
								ui.addNotification(null, E("p", {}, _("Scenario name cannot be empty.")), "error");
								return;
							}
							var payload = (payloadInput.value || "").trim();
							var baseId = "custom_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
						if (!baseId || baseId === "custom_") baseId = "custom_card";
							var newId = baseId;
							var n = 2;
							while (appFindIndexById(newId) >= 0) {
								newId = baseId + "_" + n;
								n++;
							}
							var card = {
								id: newId,
								name: name,
								desc: "",
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
					}, _("Create"))
				])
			]));
		};

		window.resetDefaultApps = function() {
			if (!confirm(_("Are you sure you want to restore the full default application library?\nAll custom scenarios and custom rules will be discarded."))) return;
			ui.showModal(_("Resetting"), [ E("p", { "class": "spinning" }, _("Restoring default application library...")) ]);
			callResetApps().then(function(res) {
				if (res && res.success === false)
					throw new Error(res.error || _("Failed to restore default application library"));
				return callGetApps();
			}).then(function(res) {
				appsList = (res && res.apps) ? res.apps : [];
				appExpanded = {};
				renderAppCards();
				ui.hideModal();
				ui.addNotification(null, E("p", {}, "✅ " + _("Default application library restored successfully!")), "success");
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E("p", {}, err.message), "error");
			});
		};

		// ---------------- 4. 终极全量保存处理函数 ----------------
		window.saveAllRoutingSettings = function() {
			syncProvidersFromDom();

			// 展开卡片中已输入但未点击“添加”的规则不允许被静默丢弃
			var pendingRules = [];
			appsList.forEach(function(app, idx) {
				if (!appExpanded[app.id]) return;
				var payloadEl = document.getElementById('app_newpayload_' + idx);
				if (!payloadEl) return;
				var pendingPayload = (payloadEl.value || '').trim();
				if (pendingPayload) pendingRules.push((app.name || app.id) + ': ' + pendingPayload);
			});
			if (pendingRules.length) {
				ui.addNotification(null, E('p', {},
					_('You have typed custom rules that were not added yet. Click "Add" on each card before saving:') + ' ' + pendingRules.join('; ')
				), 'warning');
				return;
			}

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

			// 无名卡片不静默丢弃：补齐占位名后保存，并提示用户
			var namelessCount = 0;
			var validApps = appsList.filter(a => a).map(function(a) {
				if (!a.name) {
					namelessCount++;
					a.name = _('Unnamed Scenario');
				}
				return a;
			});
			if (namelessCount) {
				ui.addNotification(null, E('p', {},
					_('%d scenario card(s) had no name and were saved as "Unnamed Scenario".').format(namelessCount)
				), 'warning');
			}

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

			// 将卡片归一化为可比对的投影，避免依赖字段顺序以外的无关差异
			function appProjection(app) {
				return {
					id: app.id || '',
					name: app.name || '',
					target: app.target || '',
					enabled: (app.enabled === false || app.enabled === 'false' || app.enabled === '0' || app.enabled === 0) ? false : true,
					builtin_rules: (app.builtin_rules || []).map(function(r) {
						return (r && r.type ? r.type : '') + '|' + (r && r.payload ? r.payload : '');
					}),
					custom_rules: (app.custom_rules || []).map(function(r) {
						return (r && r.type ? r.type : '') + '|' + (r && r.payload ? r.payload : '');
					})
				};
			}

			var sentProjection = JSON.stringify(validApps.map(appProjection));

			Promise.all([
				uci.save(),
				callSaveProviders(validProviders),
				callSaveGroups(validGroups),
				callSaveApps(validApps)
			]).then(function(results) {
				// 三个保存接口现在都会回传引擎真实结果，任一被拒绝都必须中止，
				// 否则会出现「界面提示成功、实际只保存了一部分」的半成功状态
				var failed = [
					{ name: _('Provider Subscriptions'), res: results[1] },
					{ name: _('Proxy Groups'), res: results[2] },
					{ name: _('Application Cards'), res: results[3] }
				].filter(function(x) { return !x.res || x.res.success === false; });

				if (failed.length) {
					var detail = failed.map(function(x) {
						return x.name + (x.res && x.res.error ? ' (' + x.res.error + ')' : '');
					}).join('; ');
					throw new Error(_('Failed to save: %s').replace('%s', detail));
				}

				return callCompileReload();
			}).then(function(comp) {
				if (!comp || comp.success === false) {
					throw new Error(comp && comp.error ? comp.error : _('Configuration compilation failed. Please check the log for details.'));
				}
				// 保存接口可能返回成功但落库结果与提交内容不一致，必须回读校验
				return callGetApps().then(function(res) {
					if (!res || res.success === false) {
						throw new Error(_('Application card library was not saved as expected. Please check the log for details.'));
					}
					var stored = (res.apps && res.apps.length >= 0) ? res.apps : [];
					var storedProjection = JSON.stringify(stored.map(appProjection));
					if (storedProjection !== sentProjection) {
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
				]),

					E('div', { 'class': 'cbi-section' }, [
						E('h3', {}, _('5. Configuration Backup & Disaster Recovery')),
						E('p', { 'style': 'margin-bottom: 12px; color: #64748b; font-size: 13px;' },
							_('Export or restore the complete configuration (all 32 slots, proxy groups, application card library, and core settings).')
						),
						E('div', { 'style': 'display: flex; gap: 10px; align-items: center; flex-wrap: wrap;' }, [
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-action',
								'click': window.exportOmniBackup
							}, '📦 ' + _('Export Backup Archive')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-apply',
								'click': function() {
									var fi = document.getElementById('omni_backup_file_input');
									if (fi) fi.click();
								}
							}, '📥 ' + _('Import & Restore Backup')),
							E('input', {
								'type': 'file',
								'id': 'omni_backup_file_input',
								'accept': '.json',
								'style': 'display: none;',
								'change': window.handleBackupFileSelect
							})
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
					E('div', { 'style': 'display: flex; gap: 10px; align-items: center; flex-wrap: wrap;' }, [
						E('button', {
							'type': 'button',
							'class': 'cbi-button cbi-button-action',
							'click': function() { addProvider(); }
						}, _('+ Add Provider')),
						E('button', {
							'type': 'button',
							'id': 'btn_update_providers',
							'class': 'cbi-button cbi-button-apply',
							'click': window.updateAllSubscriptionsNow
						}, '🔄 ' + _('Update All Subscriptions Now'))
					])
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
								targetOptionsWith(uci.get('omniclash', 'config', 'cn_target') || 'DIRECT').map(function(t) {
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
								targetOptionsWith(uci.get('omniclash', 'config', 'final_target') || '🚀 节点选择').map(function(t) {
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
			renderGroupCards();
			renderAppCards();
		}, 50);

		return viewEl;
	}
});
