'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require omniclash.ui as ocui';

var callGetLogs = rpc.declare({
	object: 'luci.omniclash',
	method: 'get_logs'
});

var callClearLogs = rpc.declare({
	object: 'luci.omniclash',
	method: 'clear_logs'
});

return view.extend({
	load: function() {
		return callGetLogs();
	},

	render: function(res) {
		ocui.init();
		var logContent = (res && res.log) ? res.log : _('No running logs available');

		window.clearOmniLogs = function() {
			ui.showModal(_('Clearing Logs'), [ E('p', { 'class': 'spinning' }, _('Clearing core and plugin log files...')) ]);
			callClearLogs().then(function(res) {
				if (res && res.success === false)
					throw new Error(res.error || _('Failed to clear logs'));
				ui.hideModal();
				var area = document.getElementById('omniclash_log_area');
				if (area) area.value = _('Logs cleared, waiting for new entries...');
				ui.addNotification(null, E('p', {}, '✅ ' + _('Running logs cleared successfully!')), 'success');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, err.message), 'error');
			});
		};

		window.refreshOmniLogs = function() {
			callGetLogs().then(function(r) {
				var area = document.getElementById('omniclash_log_area');
				if (area && r && r.log !== undefined) {
					area.value = r.log || _('No logs');
					area.scrollTop = area.scrollHeight;
				}
			});
		};

		var viewEl = E('div', { 'class': 'cbi-map oc' }, [
			E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;' }, [
				E('div', {}, [
					E('h2', { 'style': 'margin: 0;' }, _('OmniClash Live Logs')),
					E('div', { 'style': 'font-size: 12px; color: var(--oc-fg-3); margin-top: 4px;' }, _('Live Mihomo core log stream (auto-scrolls every 3 seconds)'))
				]),
				E('div', { 'style': 'display: flex; gap: 8px;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': window.refreshOmniLogs
					}, '🔄 ' + _('Refresh')),
					E('button', {
						'class': 'cbi-button cbi-button-remove',
						'click': window.clearOmniLogs
					}, '🗑️ ' + _('Clear Logs'))
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

		poll.add(function() {
			return callGetLogs().then(function(r) {
				var area = document.getElementById('omniclash_log_area');
				if (area && r && r.log !== undefined) {
					area.value = r.log || _('No logs');
					area.scrollTop = area.scrollHeight;
				}
			});
		}, 3);

		return viewEl;
	}
});
