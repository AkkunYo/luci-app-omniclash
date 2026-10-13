'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var callGetLogs = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_logs',
	
});

var callClearLogs = rpc.declare({
	object: 'luci.omniclash',
	method: 'clear_logs',
	
});

return view.extend({
	load: function() {
		return callGetLogs();
	},

	render: function(res) {
		var logContent = (res && res.log) ? res.log : _('暂无运行日志');

		window.clearOmniLogs = function() {
			ui.showModal(_('正在清空日志'), [ E('p', { 'class': 'spinning' }, _('正在清空内核日志与插件日志...')) ]);
			callClearLogs().then(function() {
				ui.hideModal();
				var area = document.getElementById('omniclash_log_area');
				if (area) area.value = _('日志已清空，等待新日志写入...');
				ui.addNotification(null, E('p', {}, _('✅ 运行日志已全部清空！')), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		window.refreshOmniLogs = function() {
			callGetLogs().then(function(r) {
				var area = document.getElementById('omniclash_log_area');
				if (area && r && r.log !== undefined) {
					area.value = r.log || _('暂无日志');
					area.scrollTop = area.scrollHeight;
				}
			});
		};

		var viewEl = E('div', { 'class': 'cbi-map' }, [
			E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;' }, [
				E('div', {}, [
					E('h2', { 'style': 'margin: 0;' }, _('OmniClash 实时运行日志')),
					E('div', { 'style': 'font-size: 12px; color: #94a3b8; margin-top: 4px;' }, _('实时监听 Mihomo 核心运行日志流（每 3 秒自动滚动更新）'))
				]),
				E('div', { 'style': 'display: flex; gap: 8px;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': window.refreshOmniLogs
					}, _('🔄 立即刷新')),
					E('button', {
						'class': 'cbi-button cbi-button-remove',
						'click': window.clearOmniLogs
					}, _('🗑️ 清空日志'))
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('textarea', {
					'id': 'omniclash_log_area',
					'class': 'cbi-input-textarea',
					'style': 'width: 100%; height: 560px; font-family: monospace; font-size: 12px; line-height: 1.5;',
					'readonly': 'readonly'
				}, logContent)
			])
		]);

		// 每 3 秒自动轮询更新日志并滚动到底部
		poll.add(function() {
			return callGetLogs().then(function(r) {
				var area = document.getElementById('omniclash_log_area');
				if (area && r && r.log !== undefined) {
					area.value = r.log || _('暂无日志');
					area.scrollTop = area.scrollHeight;
				}
			});
		}, 3);

		return viewEl;
	}
});
