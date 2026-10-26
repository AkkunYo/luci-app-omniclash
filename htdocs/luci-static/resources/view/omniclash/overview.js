'use strict';
'require view';
'require dom';
'require poll';
'require uci';
'require rpc';
'require form';
'require ui';

var callGetStatus = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_status'
});

var callServiceCtl = rpc.declare({
	object: 'luci.omniclash',
	method: 'service_ctl',
	params: [ 'action' ]
});

var callUpdateApp = rpc.declare({
	object: 'luci.omniclash',
	method: 'update_app'
});

var callUpdateCore = rpc.declare({
	object: 'luci.omniclash',
	method: 'update_core'
});

var callCompileReload = rpc.declare({
	object: 'luci.omniclash',
	method: 'compile_reload'
});

return view.extend({
	load: function() {
		return Promise.all([
			callGetStatus(),
			uci.load('omniclash')
		]);
	},

	render: function(data) {
		var status = (data && data[0]) ? data[0] : {};
		var isRunning = !!status.running;
		var uptimeSec = status.uptime || 0;
		var days = Math.floor(uptimeSec / 86400);
		var hours = Math.floor((uptimeSec % 86400) / 3600);
		var mins = Math.floor((uptimeSec % 3600) / 60);
		var uptimeStr = _('%sd %sh %sm').replace('%s', days).replace('%s', hours).replace('%s', mins);

		var mapTitle = [
			E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center;' }, [
				E('span', {}, _('OmniClash Overview')),
				E('a', {
					'href': 'https://github.com/AkkunYo/luci-app-omniclash',
					'target': '_blank',
					'style': 'display: inline-flex; align-items: center; gap: 6px; text-decoration: none; color: inherit; opacity: 0.8; font-size: 13px; font-weight: normal;',
					'title': 'GitHub: AkkunYo/luci-app-omniclash'
				}, [
					E('svg', {
						'viewBox': '0 0 16 16',
						'width': '20',
						'height': '20',
						'fill': 'currentColor',
						'style': 'vertical-align: middle;'
					}, [
						E('path', {
							'd': 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'
						})
					]),
					E('span', {}, 'GitHub')
				])
			])
		];

		var m = new form.Map('omniclash', mapTitle);

		var s = m.section(form.NamedSection, 'config', 'omniclash');
		s.anonymous = true;
		s.addremove = false;

		// 1. 运行状态与启用开关 (合并为第一行)
		var o = s.option(form.Flag, 'enabled', _('Running Status'));
		o.rmempty = false;
		o.default = '1';

		var origRenderWidget = o.renderWidget;
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			var node = origRenderWidget.apply(this, [section_id, option_index, cfgvalue]);
			var statusWrap = E('span', {
				'id': 'omni_core_status_wrap',
				'style': 'display: inline-flex; align-items: center; gap: 8px; margin-left: 14px; ' + (isRunning ? 'color: #059669; font-weight: 600;' : 'color: #64748b;')
			}, [
				isRunning ? E('span', {
					'id': 'omni_status_dot',
					'style': 'width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: #10b981;'
				}) : '',
				E('span', {
					'id': 'omni_status_desc',
					'style': 'font-size: 13px;'
				}, isRunning ? ('✓ ' + _('Running (PID: %s)').replace('%s', status.pid || '-')) : ('□ ' + _('Not Running')))
			]);

			return E('div', { 'style': 'display: flex; align-items: center;' }, [
				node,
				statusWrap
			]);
		};

		// 2. 硬件内存与性能预设 (form.ListValue)
		o = s.option(form.ListValue, 'perf_profile', _('Performance Profile'));
		o.value('auto', _('Auto-detect (Recommended)'));
		o.value('standard', _('High-Performance Mode (Full Features)'));
		o.value('compact', _('Low-Memory Compact Mode (Optimized for <= 256MB)'));
		o.default = 'auto';

		var isCompactActive = (status.active_profile === 'compact');
		var memInfoStr = (status.mem_total_mb || 0) + ' MB (' + _('Available: %s MB').replace('%s', status.mem_free_mb || 0) + ')';
		if (isCompactActive) {
			o.description = '🟡 ' + _('Memory: %s | Low-Memory Mode Active: GeoData disabled, process tracking off, saving 40MB+ RAM to prevent OOM on 256MB devices.').replace('%s', memInfoStr);
		} else {
			o.description = '🟢 ' + _('Memory: %s | High-Performance Mode Active: Full proxy groups and fine-grained application rule streams enabled.').replace('%s', memInfoStr);
		}

		// 4. 插件版本 (结果卡片式检查更新)
		o = s.option(form.DummyValue, '_app_version', _('App Version'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return E('div', { 'style': 'display: flex; align-items: center; gap: 10px;' }, [
				E('span', {
					'style': 'font-family: monospace; font-size: 13px; font-weight: 600;'
				}, (status.app_version && status.app_version.startsWith('v')) ? status.app_version : ('v' + (status.app_version || '0.0.1-1'))),
				E('button', {
					'type': 'button',
					'class': 'cbi-button',
					'style': 'padding: 2px 8px; font-size: 12px;',
					'click': function() {
						ui.showModal(_('Checking & Updating OmniClash'), [
							E('p', { 'class': 'spinning' }, _('Checking and updating luci-app-omniclash from software repository...'))
						]);
						callUpdateApp().then(function(res) {
							var isNew = (res && res.new_version && res.new_version !== ('v' + (status.app_version || '')));
							var modalBody = [];
							if (res && res.success) {
								modalBody = [
									E('div', { 'style': 'padding: 10px 0;' }, [
										E('p', { 'style': 'font-size: 14px; font-weight: 500; color: #059669; margin-bottom: 8px;' },
											'✅ ' + _('App check/update completed! Current app version: %s').replace('%s', res.new_version || '')
										),
										E('p', { 'style': 'color: #64748b; font-size: 13px; margin: 0;' },
											res.msg || _('Already on latest version or updated successfully.')
										)
									]),
									E('div', { 'class': 'right', 'style': 'margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px;' }, [
										E('button', {
											'type': 'button',
											'class': 'cbi-button cbi-button-apply',
											'click': function() {
												ui.hideModal();
												if (isNew) window.location.reload();
											}
										}, isNew ? _('OK & Refresh Page') : _('OK'))
									])
								];
							} else {
								modalBody = [
									E('div', { 'style': 'padding: 10px 0;' }, [
										E('p', { 'style': 'font-size: 14px; font-weight: 500; color: #dc2626; margin-bottom: 8px;' },
											'❌ ' + _('App update failed')
										),
										E('p', { 'style': 'color: #64748b; font-size: 13px; margin: 0;' },
											(res && res.error) || _('Failed to fetch update from repository.')
										)
									]),
									E('div', { 'class': 'right', 'style': 'margin-top: 16px; display: flex; justify-content: flex-end;' }, [
										E('button', { 'type': 'button', 'class': 'cbi-button', 'click': ui.hideModal }, _('Dismiss'))
									])
								];
							}
							ui.showModal(_('OmniClash Update Result'), modalBody);
						}).catch(function(err) {
							ui.showModal(_('OmniClash Update Result'), [
								E('p', { 'style': 'color: #dc2626; padding: 10px 0;' }, '❌ ' + err.message),
								E('div', { 'class': 'right', 'style': 'margin-top: 16px; display: flex; justify-content: flex-end;' }, [
									E('button', { 'type': 'button', 'class': 'cbi-button', 'click': ui.hideModal }, _('Dismiss'))
								])
							]);
						});
					}
				}, _('Check Update'))
			]);
		};

		// 5. 核心版本 (结果卡片式检查更新)
		o = s.option(form.DummyValue, '_core_version', _('Core Version'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return E('div', { 'style': 'display: flex; align-items: center; gap: 10px;' }, [
				E('span', {
					'style': 'font-family: monospace; font-size: 13px; font-weight: 600;'
				}, (status.core_version && status.core_version.startsWith('v')) ? status.core_version : ('v' + (status.core_version || '1.19.32'))),
				E('button', {
					'type': 'button',
					'class': 'cbi-button',
					'style': 'padding: 2px 8px; font-size: 12px;',
					'click': function() {
						ui.showModal(_('Checking & Updating Mihomo Core'), [
							E('p', { 'class': 'spinning' }, _('Checking and updating /usr/bin/mihomo core binary from releases...'))
						]);
						callUpdateCore().then(function(res) {
							var isNew = (res && res.new_version && res.new_version !== (status.core_version || ''));
							var modalBody = [];
							if (res && res.success) {
								modalBody = [
									E('div', { 'style': 'padding: 10px 0;' }, [
										E('p', { 'style': 'font-size: 14px; font-weight: 500; color: #059669; margin-bottom: 8px;' },
											'✅ ' + _('Core check/update completed! Current core version: %s').replace('%s', res.new_version || '')
										),
										E('p', { 'style': 'color: #64748b; font-size: 13px; margin: 0;' },
											res.msg || _('Already on latest version or updated successfully.')
										)
									]),
									E('div', { 'class': 'right', 'style': 'margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px;' }, [
										E('button', {
											'type': 'button',
											'class': 'cbi-button cbi-button-apply',
											'click': function() {
												ui.hideModal();
												if (isNew) window.location.reload();
											}
										}, isNew ? _('OK & Refresh Page') : _('OK'))
									])
								];
							} else {
								modalBody = [
									E('div', { 'style': 'padding: 10px 0;' }, [
										E('p', { 'style': 'font-size: 14px; font-weight: 500; color: #dc2626; margin-bottom: 8px;' },
											'❌ ' + _('Core update failed')
										),
										E('p', { 'style': 'color: #64748b; font-size: 13px; margin: 0;' },
											(res && res.error) || _('Failed to fetch update from repository.')
										)
									]),
									E('div', { 'class': 'right', 'style': 'margin-top: 16px; display: flex; justify-content: flex-end;' }, [
										E('button', { 'type': 'button', 'class': 'cbi-button', 'click': ui.hideModal }, _('Dismiss'))
									])
								];
							}
							ui.showModal(_('Mihomo Core Update Result'), modalBody);
						}).catch(function(err) {
							ui.showModal(_('Mihomo Core Update Result'), [
								E('p', { 'style': 'color: #dc2626; padding: 10px 0;' }, '❌ ' + err.message),
								E('div', { 'class': 'right', 'style': 'margin-top: 16px; display: flex; justify-content: flex-end;' }, [
									E('button', { 'type': 'button', 'class': 'cbi-button', 'click': ui.hideModal }, _('Dismiss'))
								])
							]);
						});
					}
				}, _('Check Update'))
			]);
		};

		// 6. 运行时间
		o = s.option(form.DummyValue, '_uptime', _('System Uptime'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return E('span', { 'id': 'omni_uptime_span', 'style': 'color: #64748b; font-family: monospace; font-size: 13px;' }, uptimeStr);
		};

		// 7. 快捷操作
		o = s.option(form.DummyValue, '_actions', _('Quick Actions'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return E('div', { 'style': 'display: flex; gap: 10px; flex-wrap: wrap;' }, [
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-action',
					'click': function() {
						window.open('http://' + window.location.hostname + ':9090/ui', '_blank');
					}
				}, '🌐 ' + _('Open Dashboard (Zashboard)')),
				E('button', {
					'type': 'button',
					'class': 'cbi-button',
					'click': function() {
						ui.showModal(_('Compiling Configuration'), [ E('p', { 'class': 'spinning' }, _('Compiling template and provider node pool with seamless reload...')) ]);
						callCompileReload().then(function(res) {
							ui.hideModal();
							if (res && res.success === false) {
								ui.addNotification(null, E('p', {}, '❌ ' + (res.error || _('Core configuration compilation failed!'))), 'error');
								return;
							}
							ui.addNotification(null, E('p', {}, '✅ ' + _('Core configuration successfully compiled and reloaded!')), 'success');
						}).catch(function(err) {
							ui.hideModal();
							ui.addNotification(null, E('p', {}, err.message), 'error');
						});
					}
				}, '🔄 ' + _('Compile & Reload'))
			]);
		};

		return m.render().then(L.bind(function(m, nodes) {
			poll.add(function() {
				return callGetStatus().then(function(s) {
					s = s || {};
					var wrap = document.getElementById('omni_core_status_wrap');
					if (wrap) {
						var running = !!s.running;
						wrap.style.color = running ? '#059669' : '#64748b';
						wrap.style.fontWeight = running ? '600' : 'normal';
						dom.content(wrap, [
							running ? E('span', {
								'id': 'omni_status_dot',
								'style': 'width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: #10b981;'
							}) : '',
							E('span', {
								'id': 'omni_status_desc',
								'style': 'font-size: 13px;'
							}, running ? ('✓ ' + _('Running (PID: %s)').replace('%s', s.pid || '-')) : ('□ ' + _('Not Running')))
						]);
					}
				});
			}, 3);
			return nodes;
		}, this, m));
	},

	handleSaveApply: function(ev, mode) {
		return this.handleSave(ev).then(function() {
			return ui.changes.apply(mode == '0');
		}).then(function() {
			var enabled = uci.get('omniclash', 'config', 'enabled');
			return callServiceCtl(enabled === '0' ? 'stop' : 'start').then(function(res) {
				// 服务真实起停结果必须回显，否则开关与守护进程状态会静默脱节
				if (res && res.success === false)
					throw new Error(res.error || _('Failed to change service state'));
				return res;
			});
		});
	}
});
