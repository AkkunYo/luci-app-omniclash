'use strict';
'require view';
'require rpc';
'require poll';
'require fs';
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
		return callGetStatus();
	},

	render: function(status) {
		status = status || {};
		var isRunning = !!status.running;
		var isEnabled = status.enabled !== false;
		var uptimeSec = status.uptime || 0;
		var days = Math.floor(uptimeSec / 86400);
		var hours = Math.floor((uptimeSec % 86400) / 3600);
		var mins = Math.floor((uptimeSec % 3600) / 60);
		var uptimeStr = days + '天 ' + hours + '小时 ' + mins + '分钟';

		window.ctlService = function(action, label) {
			ui.showModal(_('正在执行: ') + label, [
				E('p', { 'class': 'spinning' }, _('正在执行服务操作 (') + label + _(')，请稍候...'))
			]);
			callServiceCtl(action).then(function() {
				setTimeout(function() {
					callGetStatus().then(function() {
						ui.hideModal();
						ui.addNotification(null, E('p', {}, _('✅ 服务操作【') + label + _('】已成功执行！')), 'success');
						window.location.reload();
					});
				}, 1500);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		var viewEl = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('OmniClash 运行概览')),

			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('运行状态')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', {
							'id': 'omni_core_badge',
							'style': 'display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: bold; color: white; background:' + (isRunning ? '#10b981' : '#ef4444')
						}, isRunning ? _('运行中 (PID: ') + (status.pid || '-') + ')' : _('已停止')),
						E('span', {
							'id': 'omni_enable_badge',
							'style': 'display: inline-block; margin-left: 10px; padding: 3px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; color: ' + (isEnabled ? '#2563eb' : '#94a3b8') + '; background: ' + (isEnabled ? 'rgba(37, 99, 235, 0.12)' : 'rgba(148, 163, 184, 0.15)')
						}, isEnabled ? _('开机自启: 已启用') : _('开机自启: 已禁用'))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('插件版本 (App Version)')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', {
							'style': 'display: inline-block; padding: 3px 10px; border-radius: 4px; font-family: monospace; font-weight: bold; background: rgba(139, 92, 246, 0.15); color: #7c3aed;'
						}, 'luci-app-omniclash v' + (status.app_version || '1.2.0-1'))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('核心版本 (Core Version)')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', {
							'id': 'omni_core_ver_badge',
							'style': 'display: inline-block; padding: 3px 10px; border-radius: 4px; font-family: monospace; font-weight: bold; background: rgba(16, 185, 129, 0.15); color: #059669; margin-right: 10px;'
						}, 'Mihomo Meta ' + (status.core_version || 'v1.19.31')),
						E('button', {
							'class': 'cbi-button cbi-button-neutral',
							'click': function() {
								ui.showModal(_('正在检查并升级 Mihomo 核心'), [
									E('p', { 'class': 'spinning' }, _('正在通过软件源 / GitHub Releases 检查并升级 /usr/bin/mihomo 核心二进制...'))
								]);
								callUpdateCore().then(function(res) {
									ui.hideModal();
									if (res && res.success) {
										ui.addNotification(null, E('p', {}, _('✅ 核心检查/更新完成！当前核心版本: ') + (res.new_version || '')), 'success');
										setTimeout(function() { window.location.reload(); }, 1000);
									} else {
										ui.addNotification(null, E('p', {}, _('核心更新失败')), 'error');
									}
								}).catch(function(err) {
									ui.hideModal();
									ui.addNotification(null, E('p', {}, err.message), 'error');
								});
							}
						}, _('⬆️ 检查并更新核心')),
						E('div', { 'style': 'font-size: 11px; color: #94a3b8; margin-top: 4px; font-family: monospace;' }, status.core_full || '')
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('系统连续运行时间')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', { 'id': 'omni_uptime_span', 'style': 'color: #94a3b8; font-family: monospace;' }, uptimeStr)
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('服务启停与控制')),
					E('div', { 'class': 'cbi-value-field', 'style': 'display: flex; gap: 8px; flex-wrap: wrap;' }, [
						isRunning ? E('button', {
							'class': 'cbi-button cbi-button-remove',
							'click': function() { window.ctlService('stop', '停止并禁用服务'); }
						}, _('⏹️ 停止服务')) : E('button', {
							'class': 'cbi-button cbi-button-apply',
							'click': function() { window.ctlService('start', '启用并启动服务'); }
						}, _('▶️ 启动服务')),
						E('button', {
							'class': 'cbi-button cbi-button-action',
							'click': function() { window.ctlService('restart', '重启服务'); }
						}, _('🔁 重启服务')),
						E('button', {
							'class': 'cbi-button cbi-button-apply',
							'click': function() {
								ui.showModal(_('正在合流编译'), [ E('p', { 'class': 'spinning' }, _('正在执行模板+节点池合流并平滑热重载...')) ]);
								callCompileReload().then(function() {
									ui.hideModal();
									ui.addNotification(null, E('p', {}, _('✅ 核心配置已成功合流热重载！')), 'success');
								}).catch(function(err) {
									ui.hideModal();
									ui.addNotification(null, E('p', {}, err.message), 'error');
								});
							}
						}, _('🔄 合流编译并热重载'))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('核心控制面板 (Zashboard)')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('button', {
							'class': 'cbi-button cbi-button-action',
							'style': 'margin-right: 8px;',
							'click': function() {
								window.open('http://' + window.location.hostname + ':9090/ui', '_blank');
							}
						}, _('🌐 打开控制面板')),
						E('button', {
							'class': 'cbi-button cbi-button-neutral',
							'click': function() {
								ui.showModal(_('正在更新控制面板'), [ E('p', { 'class': 'spinning' }, _('正在从官方源下载并更新最新的 Zashboard 面板资源...')) ]);
								fs.exec('/usr/bin/curl', [
									'-sL',
									'https://hk.gh-proxy.org/https://github.com/Zephyruso/zashboard/releases/latest/download/dist-cdn-fonts.zip',
									'-o',
									'/tmp/zashboard.zip'
								]).then(function() {
									return fs.exec('/usr/bin/unzip', ['-o', '-q', '/tmp/zashboard.zip', '-d', '/etc/omniclash/run/ui/']);
								}).then(function() {
									return fs.exec('/bin/rm', ['-f', '/tmp/zashboard.zip']);
								}).then(function() {
									ui.hideModal();
									ui.addNotification(null, E('p', {}, _('✅ Zashboard 控制面板已成功更新到最新版本！')), 'success');
								}).catch(function(err) {
									ui.hideModal();
									ui.addNotification(null, E('p', {}, err.message), 'error');
								});
							}
						}, _('⬇️ 更新控制面板'))
					])
				])
			])
		]);

		poll.add(function() {
			return callGetStatus().then(function(s) {
				s = s || {};
				var badge = document.getElementById('omni_core_badge');
				if (badge) {
					badge.style.background = s.running ? '#10b981' : '#ef4444';
					badge.innerText = s.running ? _('运行中 (PID: ') + (s.pid || '-') + ')' : _('已停止');
				}
			});
		}, 3);

		return viewEl;
	}
});
