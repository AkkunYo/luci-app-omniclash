'use strict';
'require view';
'require rpc';
'require uci';
'require fs';
'require ui';
'require omniclash.ui as ocui';

var callGetProviders = rpc.declare({ object: 'luci.omniclash', method: 'get_providers' });
var callGetGroups = rpc.declare({ object: 'luci.omniclash', method: 'get_groups' });
var callResetGroups = rpc.declare({ object: 'luci.omniclash', method: 'reset_groups' });
var callGetApps = rpc.declare({ object: 'luci.omniclash', method: 'get_apps' });
var callResetApps = rpc.declare({ object: 'luci.omniclash', method: 'reset_apps' });
var callGetGeoTags = rpc.declare({ object: 'luci.omniclash', method: 'get_geodata_tags' });
var callUpdateProviders = rpc.declare({ object: 'luci.omniclash', method: 'update_providers' });
var callExportBackup = rpc.declare({ object: 'luci.omniclash', method: 'export_backup' });
var callImportBackup = rpc.declare({ object: 'luci.omniclash', method: 'import_backup', params: [ 'backup' ] });
var callSaveAll = rpc.declare({
	object: 'luci.omniclash',
	method: 'save_all',
	params: [ 'settings', 'providers', 'groups', 'slot_group', 'apps' ]
});

var GROUP_TYPES = [ 'select', 'url-test', 'fallback', 'load-balance' ];
var RULE_TYPES = [
	'DOMAIN-SUFFIX', 'DOMAIN', 'DOMAIN-KEYWORD', 'DOMAIN-REGEX', 'DOMAIN-WILDCARD',
	'GEOSITE', 'GEOIP', 'IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'SRC-IP-CIDR',
	'DST-PORT', 'SRC-PORT', 'NETWORK', 'PROCESS-NAME', 'RULE-SET', 'AND', 'OR', 'NOT'
];
var RULE_HINTS = {
	'DOMAIN-SUFFIX': 'example.com', 'DOMAIN': 'www.example.com', 'DOMAIN-KEYWORD': 'example',
	'DOMAIN-REGEX': '^ab[0-9]+\\.example\\.com$', 'DOMAIN-WILDCARD': '*.example.com',
	'GEOSITE': 'netflix', 'GEOIP': 'telegram', 'IP-CIDR': '1.2.3.0/24', 'IP-CIDR6': '2001:db8::/32',
	'IP-ASN': '13335', 'SRC-IP-CIDR': '192.168.1.0/24', 'DST-PORT': '25565', 'SRC-PORT': '1024-2048',
	'NETWORK': 'udp', 'PROCESS-NAME': 'curl', 'RULE-SET': 'reject_ad',
	'AND': '((DOMAIN,a.com),(NETWORK,udp))', 'OR': '((DOMAIN,a.com),(DOMAIN,b.com))', 'NOT': '((DOMAIN,a.com))'
};
var TYPE_TAG = { 'select': 'pri', 'url-test': 'ok', 'fallback': 'warn', 'load-balance': 'vio' };
var BUILTIN_TARGETS = [ 'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS' ];

function isEnabled(v) {
	return !(v === false || v === 'false' || v === '0' || v === 0);
}

function clone(o) {
	return JSON.parse(JSON.stringify(o));
}

/* 按内容推断策略组分类，仅用于筛选显示，不影响生成的配置 */
function groupCategory(g) {
	var n = g.name || '';
	if (/专线/.test(n)) return 'line';
	if (g.type === 'url-test' && g['include-all']) return 'region';
	if (g.type === 'load-balance' || /节点选择|自动选择|全部节点|前置|住宅|漏网/.test(n)) return 'core';
	return 'app';
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('omniclash'),
			callGetProviders(),
			callGetGroups(),
			callGetApps(),
			L.resolveDefault(callGetGeoTags(), {}),
			L.resolveDefault(fs.read('/etc/omniclash/run/config.yaml'), '')
		]);
	},

	render: function(data) {
		ocui.init();

		var state = {
			providers: ((data[1] && data[1].providers) || []).map(clone),
			groups: ((data[2] && data[2].groups) || []).map(clone),
			slotGroup: clone((data[2] && data[2].slot_group) || { type: 'select', proxies: [] }),
			apps: ((data[3] && data[3].apps) || []).map(clone),
			geosite: (data[4] && data[4].geosite) || [],
			geoip: (data[4] && data[4].geoip) || [],
			runConfig: data[5] || '',
			groupCat: 'all',
			groupQuery: '',
			appQuery: '',
			appOpen: {},
			dirty: false
		};

		var self = this;
		this.state = state;

		var markDirty = function() {
			state.dirty = true;
			var bar = document.getElementById('oc_dirty');
			if (bar) bar.style.display = '';
		};
		this.markDirty = markDirty;

		var targetOptions = function(exclude) {
			var out = BUILTIN_TARGETS.slice();
			state.groups.forEach(function(g) {
				if (g.name && g.name !== exclude && out.indexOf(g.name) < 0) out.push(g.name);
			});
			return out;
		};
		this.targetOptions = targetOptions;

		var proxyCandidates = function(exclude) {
			var out = [];
			(state.slotGroup.proxies || []).concat(state.groups.map(function(g) { return g.name; })).forEach(function(n) {
				if (n && n !== exclude && out.indexOf(n) < 0) out.push(n);
			});
			[ '🟢 直连', '🛑 黑洞', 'DIRECT', 'REJECT' ].forEach(function(n) { if (out.indexOf(n) < 0) out.push(n); });
			return out;
		};
		this.proxyCandidates = proxyCandidates;

		var settingsPane = this.renderSettings();
		var providersPane = this._providersBox = E('div', { 'id': 'oc_providers' });
		var groupsPane = this._groupsBox = E('div', { 'id': 'oc_groups' });
		var appsPane = this._appsBox = E('div', { 'id': 'oc_apps' });
		var runPane = this.renderRunConfig();

		var root = ocui.root([
			E('h2', {}, _('OmniClash Subscription & Routing Hub')),
			E('div', { 'id': 'oc_dirty', 'style': 'display:none' }, ocui.note([
				E('b', {}, _('Unsaved changes. ')),
				_('Click "Save & Apply" at the bottom to validate and apply all changes in one go.')
			]))
		].concat(ocui.tabs('omniclash.routing.tab', [
			{ id: 'settings', label: '⚙️ ' + _('Core Settings'), content: settingsPane },
			{ id: 'providers', label: '📦 ' + _('Provider Subscriptions'), content: providersPane },
			{ id: 'groups', label: '🎯 ' + _('Proxy Groups'), content: groupsPane },
			{ id: 'rules', label: '🔀 ' + _('Application Routing Cards'), content: appsPane },
			{ id: 'runconfig', label: '📄 ' + _('Running Config (Readonly)'), content: runPane }
		])).concat([
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-apply', 'click': function() { self.saveAll(); } }, _('Save & Apply'))
			])
		]));

		this.renderProviders();
		this.renderGroups();
		this.renderApps();

		root.addEventListener('change', function(ev) {
			if (ev.target && ev.target.closest && ev.target.closest('#oc_settings')) markDirty();
		});
		return root;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	/* ==================== 设置 ==================== */
	renderSettings: function() {
		var g = function(k, d) { return uci.get('omniclash', 'config', k) || d; };
		var sel = function(id, value, opts) {
			return E('select', { 'id': id, 'class': 'cbi-input-select' }, opts.map(function(o) {
				return E('option', { 'value': o[0], 'selected': o[0] === value ? 'selected' : null }, o[1]);
			}));
		};
		var inp = function(id, value) {
			return E('input', { 'id': id, 'type': 'text', 'class': 'cbi-input-text oc-mono', 'value': value });
		};
		var self = this;

		var section = function(title, fields) {
			return E('div', { 'class': 'oc-card', 'style': 'margin-bottom:12px' }, [
				E('div', { 'class': 'oc-row' }, E('b', {}, title)),
				E('div', { 'class': 'oc-body', 'style': 'padding-left:12px' }, E('div', { 'class': 'oc-grid' }, fields))
			]);
		};

		var cronBox = E('input', { 'type': 'checkbox', 'id': 'set_scheduled_restart', 'checked': g('scheduled_restart', '0') === '1' ? 'checked' : null });

		return E('div', { 'id': 'oc_settings' }, [
			section(_('Traffic Proxy & System TUN Settings'), [
				ocui.field(_('TCP Proxy Mode'), sel('set_tcp_mode', g('tcp_mode', 'tun'), [
					[ 'tun', _('TUN (Pure TUN Mode, Recommended)') ], [ 'tproxy', _('TPROXY (Transparent Proxy)') ], [ 'redirect', _('Redirect') ] ])),
				ocui.field(_('UDP Proxy Mode'), sel('set_udp_mode', g('udp_mode', 'tun'), [
					[ 'tun', _('TUN (Pure TUN Mode, Recommended)') ], [ 'tproxy', _('TPROXY (Transparent Proxy)') ] ])),
				ocui.field(_('System TUN Stack'), sel('set_tun_stack', g('tun_stack', 'system'), [
					[ 'system', _('System (Kernel Native, High Performance)') ], [ 'gvisor', _('gVisor (Userspace Sandbox)') ], [ 'mixed', _('Mixed') ] ])),
				ocui.field(_('Bypass China Mainland IP'), sel('set_bypass_china_mainland_ip', g('bypass_china_mainland_ip', '0'), [
					[ '0', _('Disabled (Managed by OmniClash rules, Recommended)') ], [ '1', _('Enabled (Bypass CN IP directly)') ] ]))
			]),
			section(_('Inbound Proxy Ports'), [
				ocui.field(_('Mixed Proxy Port'), inp('set_mixed_port', g('mixed_port', '7890')), _('(Default: 7890, supports HTTP/SOCKS5 mixed)')),
				ocui.field(_('SOCKS5 Port'), inp('set_socks_port', g('socks_port', '1080')), _('(Default: 1080)'))
			]),
			section(_('DNS & Fake-IP Settings'), [
				ocui.field(_('DNS Mode'), sel('set_dns_mode', g('dns_mode', 'fake-ip'), [
					[ 'fake-ip', _('Fake-IP (Recommended)') ], [ 'redir-host', _('Redir-Host (Real IP)') ] ])),
				ocui.field(_('Fake-IP Range'), inp('set_fake_ip_range', g('fake_ip_range', '198.18.0.1/16')))
			]),
			section(_('Logging & Scheduled Restart'), [
				ocui.field(_('Log Level'), sel('set_log_level', g('log_level', 'info'), [
					[ 'warning', _('Warning (Lightweight)') ], [ 'info', _('Info (Detailed, Recommended)') ], [ 'debug', _('Debug (Troubleshooting)') ] ])),
				E('div', { 'class': 'oc-field is-check' }, [ E('label', {}, [ cronBox, _('Enable scheduled task') ]) ]),
				ocui.field(_('Cron Expression'), inp('set_scheduled_restart_cron', g('scheduled_restart_cron', '0 3 * * *')), _('(Default: 0 3 * * * Daily at 03:00)'))
			]),
			section(_('Configuration Backup & Disaster Recovery'), [
				E('div', { 'style': 'grid-column:1/-1' }, [
					E('div', { 'class': 'oc-desc' }, _('Export or restore the complete configuration (all 32 slots, proxy groups, application card library, subscriptions and core settings).')),
					E('div', { 'class': 'oc-toolbar' }, [
						ocui.btn('📦 ' + _('Export Backup Archive'), function() { self.exportBackup(); }, 'action'),
						ocui.btn('📥 ' + _('Import & Restore Backup'), function() { document.getElementById('oc_backup_file').click(); }, 'apply'),
						E('input', { 'type': 'file', 'id': 'oc_backup_file', 'accept': '.json', 'style': 'display:none', 'change': function(ev) { self.importBackup(ev); } })
					])
				])
			])
		]);
	},

	collectSettings: function() {
		var v = function(id) { var el = document.getElementById(id); return el ? (el.value || '').trim() : null; };
		var out = {};
		[ 'tcp_mode', 'udp_mode', 'tun_stack', 'bypass_china_mainland_ip', 'dns_mode', 'fake_ip_range',
		  'mixed_port', 'socks_port', 'log_level', 'scheduled_restart_cron' ].forEach(function(k) {
			var x = v('set_' + k);
			if (x != null) out[k] = x;
		});
		var cb = document.getElementById('set_scheduled_restart');
		if (cb) out.scheduled_restart = cb.checked ? '1' : '0';
		var cn = document.getElementById('set_cn_target');
		var fin = document.getElementById('set_final_target');
		if (cn) out.cn_target = cn.value;
		if (fin) out.final_target = fin.value;
		return out;
	},

	/* ==================== 订阅 Provider ==================== */
	renderProviders: function() {
		var self = this, st = this.state;
		var box = this._providersBox;
		if (!box) return;
		box.innerHTML = '';

		var list = E('div', { 'class': 'oc-list' });
		if (!st.providers.length) list.appendChild(ocui.empty(_('No subscription providers configured. Click "+ Add Provider" below.')));

		st.providers.forEach(function(p, idx) {
			var tags = [ ocui.tag(p.type || 'http', 'pri', true) ];
			if (p.prefix) tags.push(ocui.tag([ _('Prefix'), ' ', E('b', {}, p.prefix) ], null, true));
			if (p.dialer_proxy) tags.push(ocui.tag('🔗 ' + p.dialer_proxy, 'vio'));
			if (p.filter) tags.push(ocui.tag('filter: ' + p.filter, null, true));
			if (p.exclude_type) tags.push(ocui.tag('− ' + p.exclude_type, 'warn', true));
			tags.push(ocui.tag(p.interval + 's', null, true));
			if (p.udp === false) tags.push(ocui.tag('UDP off', 'warn'));

			list.appendChild(E('div', { 'class': 'oc-card' }, E('div', { 'class': 'oc-row' }, [
				E('div', { 'class': 'oc-row-main' }, [
					E('span', { 'class': 'oc-icon-txt' }, '📦'),
					E('div', { 'style': 'min-width:0;flex:1' }, [
						E('div', { 'class': 'oc-title' }, p.name || _('(unnamed)')),
						E('div', { 'class': 'oc-desc oc-mono', 'style': 'margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, p.url || p.path || '-'),
						E('div', { 'class': 'oc-sub' }, tags)
					])
				]),
				E('div', { 'class': 'oc-row-side' }, [
					ocui.btn('⚙️ ' + _('Edit'), function() { self.openProvider(idx); }),
					ocui.btn(_('Delete'), function() {
						if (!confirm(_('Delete subscription "%s"? Proxy groups that reference it must be updated too.').replace('%s', p.name))) return;
						st.providers.splice(idx, 1); self.markDirty(); self.renderProviders();
					}, 'remove')
				])
			])));
		});

		box.appendChild(ocui.head(_('Provider Subscriptions Source List'),
			_('External node pools. Only proxy nodes are imported; local groups and rules are never overwritten.'), [
				ocui.btn('+ ' + _('Add Provider'), function() { self.openProvider(-1); }, 'action'),
				ocui.btn('🔄 ' + _('Update All Subscriptions Now'), function() { self.updateProviders(this); }, 'apply')
			]));
		box.appendChild(list);
	},

	openProvider: function(idx) {
		var self = this, st = this.state;
		var isNew = idx < 0;
		var p = isNew ? { name: '', type: 'http', url: '', interval: '1800', prefix: '', proxy: '🟢 直连', health_check: true, udp: true, skip_cert_verify: true } : clone(st.providers[idx]);

		var name = ocui.input(p.name, 'my_sub', { mono: true });
		var type = ocui.select([ 'http', 'file' ], p.type || 'http');
		var url = ocui.input(p.url, 'https://example.com/sub', { mono: true });
		var path = ocui.input(p.path, './proxies/my_sub.yaml', { mono: true });
		var interval = ocui.input(p.interval || '1800', '1800', { type: 'number' });
		var prefix = ocui.input(p.prefix, 'my_', { mono: true });
		var via = ocui.select([ '' ].concat(this.targetOptions()), p.proxy || '', true);
		var dialer = ocui.select([ '' ].concat(this.targetOptions()), p.dialer_proxy || '', true);
		var filter = ocui.input(p.filter, '(?i)HK|JP', { mono: true });
		var exFilter = ocui.input(p.exclude_filter, '(?i)expire|剩余', { mono: true });
		var exType = ocui.input(p.exclude_type, 'ss|http|vmess', { mono: true });
		var hc = ocui.check(_('Enable health check'), p.health_check !== false);
		var udp = ocui.check(_('Enable UDP'), p.udp !== false && p.udp !== 'false');
		var scv = ocui.check(_('Skip TLS certificate verification'), p.skip_cert_verify === true || p.skip_cert_verify === 'true');

		via.options[0].text = _('(default)');
		dialer.options[0].text = _('(none)');

		var urlField = ocui.field(_('Subscription URL'), url);
		var pathField = ocui.field(_('Local file path'), path, _('Relative to /etc/omniclash/run'));
		var syncType = function() {
			urlField.style.display = type.value === 'http' ? '' : 'none';
			pathField.style.display = type.value === 'file' ? '' : 'none';
		};
		type.addEventListener('change', syncType);
		syncType();

		ocui.modal(isNew ? _('New Subscription') : _('Edit Subscription'), [
			E('div', { 'class': 'oc-grid is-2' }, [ ocui.field(_('Provider Tag'), name, _('Letters, digits, _ . - only')), ocui.field(_('Type'), type) ]),
			urlField, pathField,
			E('div', { 'class': 'oc-grid' }, [
				ocui.field(_('Update interval (s)'), interval),
				ocui.field(_('Node Prefix'), prefix, _('Added in front of every node name; groups filter on it'))
			]),
			E('div', { 'class': 'oc-box' }, [
				E('div', { 'class': 'oc-box-title' }, '🔗 ' + _('Chaining')),
				E('div', { 'class': 'oc-grid' }, [
					ocui.field(_('Download via'), via, _('Proxy used to fetch the subscription itself')),
					ocui.field(_('Dialer proxy (chain)'), dialer, _('Every node from this subscription connects through this group first'))
				])
			]),
			E('div', { 'class': 'oc-box' }, [
				E('div', { 'class': 'oc-box-title' }, '🧹 ' + _('Node filtering')),
				E('div', { 'class': 'oc-grid' }, [
					ocui.field(_('Keep nodes matching'), filter),
					ocui.field(_('Drop nodes matching'), exFilter),
					ocui.field(_('Drop protocols'), exType, _('Separate with |'))
				])
			]),
			E('div', { 'class': 'oc-grid' }, [ hc, udp, scv ])
		], function() {
			var n = (name.value || '').trim();
			if (!/^[A-Za-z0-9_.-]+$/.test(n)) { ui.addNotification(null, E('p', {}, _('Provider tag may only contain letters, digits, _ . -')), 'error'); return false; }
			if (st.providers.some(function(x, i) { return x.name === n && i !== idx; })) { ui.addNotification(null, E('p', {}, _('Provider tag already exists')), 'error'); return false; }
			if (type.value === 'http' && !/^https?:\/\//.test((url.value || '').trim())) { ui.addNotification(null, E('p', {}, _('Subscription URL must start with http:// or https://')), 'error'); return false; }

			var oldName = p.name;
			p.name = n;
			p.type = type.value;
			p.url = (url.value || '').trim();
			p.path = (path.value || '').trim();
			p.interval = (interval.value || '1800').trim();
			p.prefix = (prefix.value || '').trim();
			p.proxy = via.value;
			p.dialer_proxy = dialer.value;
			p.filter = (filter.value || '').trim();
			p.exclude_filter = (exFilter.value || '').trim();
			p.exclude_type = (exType.value || '').trim();
			p.health_check = hc.input.checked;
			p.udp = udp.input.checked;
			p.skip_cert_verify = scv.input.checked;

			if (isNew) st.providers.push(p); else st.providers[idx] = p;
			/* 订阅改名时同步更新策略组中的 use 引用 */
			if (!isNew && oldName && oldName !== n) {
				st.groups.forEach(function(g) {
					if (Array.isArray(g.use)) g.use = g.use.map(function(u) { return u === oldName ? n : u; });
				});
				self.renderGroups();
			}
			self.markDirty();
			self.renderProviders();
		});
	},

	updateProviders: function(btn) {
		btn.disabled = true;
		callUpdateProviders().then(function(res) {
			ocui.ensureOk(res, _('Failed to update subscriptions'));
			ui.addNotification(null, E('p', {}, '✅ ' + (res.msg || _('All subscriptions updated successfully!'))), 'success');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, err.message), 'error');
		}).finally(function() { btn.disabled = false; });
	},

	/* ==================== 策略组 ==================== */
	renderGroups: function() {
		var self = this, st = this.state;
		var box = this._groupsBox;
		box.innerHTML = '';

		var counts = { all: st.groups.length, line: 0, region: 0, app: 0, core: 0 };
		st.groups.forEach(function(g) { counts[groupCategory(g)]++; });

		var list = E('div', { 'class': 'oc-list' });
		var renderList = function() {
			list.innerHTML = '';
			var q = st.groupQuery.toLowerCase();
			var shown = 0;
			st.groups.forEach(function(g, idx) {
				if (st.groupCat !== 'all' && groupCategory(g) !== st.groupCat) return;
				if (q && [ g.name, g.filter, g.type ].concat(g.proxies || [], g.use || []).join(' ').toLowerCase().indexOf(q) < 0) return;
				shown++;
				list.appendChild(self.groupCard(g, idx));
			});
			if (!shown) list.appendChild(ocui.empty(_('No proxy groups match current filter or search.')));
		};

		var search = E('input', { 'type': 'text', 'class': 'cbi-input-text oc-search', 'value': st.groupQuery,
			'placeholder': '🔍 ' + _('Search name, filter, member or subscription'),
			'input': function() { st.groupQuery = (this.value || '').trim(); renderList(); } });

		box.appendChild(ocui.head(_('Structured Proxy Groups'),
			_('Each group is emitted to mihomo exactly as configured here. Node sources must be declared explicitly: child proxies, subscriptions, or include-all.'), [
				ocui.btn('+ ' + _('New Proxy Group'), function() { self.openGroup(-1); }, 'action'),
				ocui.btn('🎛️ ' + _('Slot Exit Template'), function() { self.openSlotGroup(); }),
				ocui.btn('🔄 ' + _('Reset to Default Groups'), function() { self.resetGroups(); }, 'reset')
			]));
		box.appendChild(ocui.chips([
			{ id: 'all', label: _('All'), count: counts.all },
			{ id: 'line', label: '🎯 ' + _('Dedicated Lines'), count: counts.line },
			{ id: 'region', label: '🌐 ' + _('Region Auto'), count: counts.region },
			{ id: 'app', label: '🎛️ ' + _('App Routing'), count: counts.app },
			{ id: 'core', label: '🚀 ' + _('Core Dispatch'), count: counts.core }
		], st.groupCat, function(id) { st.groupCat = id; self.renderGroups(); }));
		box.appendChild(E('div', { 'class': 'oc-toolbar' }, E('div', { 'class': 'oc-grow' }, search)));
		box.appendChild(list);
		renderList();
	},

	groupCard: function(g, idx) {
		var self = this, st = this.state;
		var tags = [ ocui.tag(g.type || 'select', TYPE_TAG[g.type] || null, true) ];
		if (g['include-all']) tags.push(ocui.tag(_('all nodes'), 'ok'));
		else if (g['include-all-providers']) tags.push(ocui.tag(_('all subscriptions'), 'ok'));
		if (Array.isArray(g.use) && g.use.length) tags.push(ocui.tag('📦 ' + g.use.join(', '), 'pri'));
		if (g.filter) tags.push(ocui.tag('filter: ' + g.filter, null, true));
		if (g['exclude-filter']) tags.push(ocui.tag('− ' + g['exclude-filter'], 'warn', true));
		if (Array.isArray(g.proxies) && g.proxies.length)
			tags.push(ocui.tag(g.proxies.slice(0, 3).join(' · ') + (g.proxies.length > 3 ? ' +' + (g.proxies.length - 3) : ''), null));
		if (g.type === 'url-test' || g.type === 'fallback') tags.push(ocui.tag((g.interval || 300) + 's / ' + (g.tolerance || 0) + 'ms', 'ok', true));
		if (g.type === 'load-balance' && g.strategy) tags.push(ocui.tag(g.strategy, 'vio', true));
		if (g.hidden) tags.push(ocui.tag(_('hidden'), 'warn'));

		var usedBy = st.apps.filter(function(a) { return a.target === g.name; }).length;
		if (usedBy) tags.push(ocui.tag(_('%d cards').format(usedBy), 'pri'));

		return E('div', { 'class': 'oc-card' }, E('div', { 'class': 'oc-row' }, [
			E('div', { 'class': 'oc-row-main' }, [
				E('span', { 'class': 'oc-idx' }, ('0' + (idx + 1)).slice(-2)),
				ocui.icon(g.icon, '🌐'),
				E('div', { 'style': 'min-width:0;flex:1' }, [ E('div', { 'class': 'oc-title' }, g.name), E('div', { 'class': 'oc-sub' }, tags) ])
			]),
			E('div', { 'class': 'oc-row-side' }, [
				ocui.btn('⚙️ ' + _('Edit'), function() { self.openGroup(idx); }),
				ocui.btn('⧉', function() { self.duplicateGroup(idx); }, null, { 'title': _('Duplicate') }),
				ocui.btn('↑', function() { self.moveItem(st.groups, idx, -1); self.renderGroups(); }, null, { 'disabled': idx === 0 ? 'disabled' : null }),
				ocui.btn('↓', function() { self.moveItem(st.groups, idx, 1); self.renderGroups(); }, null, { 'disabled': idx === st.groups.length - 1 ? 'disabled' : null }),
				ocui.btn(_('Delete'), function() { self.removeGroup(idx); }, 'remove')
			])
		]));
	},

	moveItem: function(arr, idx, off) {
		var t = idx + off;
		if (t < 0 || t >= arr.length) return;
		arr.splice(t, 0, arr.splice(idx, 1)[0]);
		this.markDirty();
	},

	duplicateGroup: function(idx) {
		var st = this.state;
		var g = clone(st.groups[idx]);
		var base = g.name + ' ' + _('copy'), n = base, i = 2;
		while (st.groups.some(function(x) { return x.name === n; })) n = base + ' ' + (i++);
		g.name = n;
		st.groups.splice(idx + 1, 0, g);
		this.markDirty();
		this.renderGroups();
	},

	removeGroup: function(idx) {
		var st = this.state;
		var g = st.groups[idx];
		var refs = [];
		st.groups.forEach(function(x) { if ((x.proxies || []).indexOf(g.name) >= 0) refs.push(x.name); });
		st.apps.forEach(function(a) { if (a.target === g.name) refs.push(a.name || a.id); });
		if ((st.slotGroup.proxies || []).indexOf(g.name) >= 0) refs.push(_('Slot Exit Template'));
		var msg = _('Delete proxy group "%s"?').replace('%s', g.name);
		if (refs.length) msg += '\n\n' + _('Still referenced by: %s\nSaving will fail until those references are removed.').replace('%s', refs.join(', '));
		if (!confirm(msg)) return;
		st.groups.splice(idx, 1);
		this.markDirty();
		this.renderGroups();
	},

	/* 策略组编辑：以原对象的完整副本为底，只回写表单展示的字段，其余 mihomo 字段原样保留 */
	groupForm: function(g, opts) {
		opts = opts || {};
		var self = this, st = this.state;
		var f = {};
		f.name = ocui.input(g.name, '🎯 ' + _('My Group'));
		f.type = ocui.select(GROUP_TYPES, g.type || 'select');
		f.icon = ocui.input(g.icon, 'https://… or 🌐', { mono: true });
		f.includeAll = ocui.check(_('Include every node (subscriptions + local)'), !!g['include-all']);
		f.includeProv = ocui.check(_('Include all subscriptions'), !!g['include-all-providers']);
		f.use = ocui.orderedPicker(st.providers.map(function(p) { return p.name; }), g.use || []);
		f.filter = ocui.input(g.filter, '(?i)HK|香港', { mono: true });
		f.exFilter = ocui.input(g['exclude-filter'], 's5v_', { mono: true });
		f.exType = ocui.input(g['exclude-type'], 'ss|http', { mono: true });
		f.proxies = ocui.orderedPicker(this.proxyCandidates(g.name), g.proxies || []);
		f.url = ocui.input(g.url, 'https://www.gstatic.com/generate_204', { mono: true });
		f.interval = ocui.input(g.interval || 300, '300', { type: 'number' });
		f.tolerance = ocui.input(g.tolerance || 50, '50', { type: 'number' });
		f.lazy = ocui.check(_('Lazy test (only test while in use)'), g.lazy !== false);
		f.strategy = ocui.select([
			{ value: 'consistent-hashing', label: 'consistent-hashing — ' + _('same target, same node') },
			{ value: 'round-robin', label: 'round-robin — ' + _('rotate every connection') },
			{ value: 'sticky-sessions', label: 'sticky-sessions — ' + _('same source+target, same node') }
		], g.strategy || 'consistent-hashing');
		f.hidden = ocui.check(_('Hide in dashboard'), !!g.hidden);

		var quick = E('div', { 'class': 'oc-tags', 'style': 'margin-top:6px' }, [
			[ '香港', '(?i)港|HK|Hong ?Kong' ], [ '台湾', '(?i)台|TW|Taiwan' ], [ '日本', '(?i)日本|JP|Japan' ],
			[ '新加坡', '(?i)新加坡|SG|Singapore' ], [ '美国', '(?i)美|US|United States' ], [ '韩国', '(?i)韩|KR|Korea' ]
		].map(function(q) {
			return E('span', { 'class': 'oc-tag is-pri', 'style': 'cursor:pointer', 'click': function() { f.filter.value = q[1]; } }, q[0]);
		}));

		var testBox = E('div', { 'class': 'oc-box' }, [
			E('div', { 'class': 'oc-box-title' }, '⚡ ' + _('Health check')),
			E('div', { 'class': 'oc-grid' }, [
				ocui.field(_('Test URL'), f.url), ocui.field(_('Interval (sec)'), f.interval), ocui.field(_('Tolerance (ms)'), f.tolerance)
			]),
			f.lazy
		]);
		var lbBox = E('div', { 'class': 'oc-box' }, [ E('div', { 'class': 'oc-box-title' }, '☢ ' + _('Load Balance Algorithm')), f.strategy ]);
		var sync = function() {
			var t = f.type.value;
			testBox.style.display = (t === 'url-test' || t === 'fallback' || t === 'load-balance') ? '' : 'none';
			lbBox.style.display = t === 'load-balance' ? '' : 'none';
		};
		f.type.addEventListener('change', sync);
		sync();

		var body = [];
		if (!opts.noName)
			body.push(E('div', { 'class': 'oc-grid is-2' }, [ ocui.field(_('Group Name'), f.name), ocui.field(_('Group Type'), f.type) ]));
		else
			body.push(ocui.field(_('Group Type'), f.type));
		body.push(E('div', { 'class': 'oc-box' }, [
			E('div', { 'class': 'oc-box-title' }, '📥 ' + _('Node sources')),
			E('div', { 'class': 'oc-grid' }, [ f.includeAll, f.includeProv ]),
			ocui.field(_('Use specific subscriptions'), f.use, _('Ignored when one of the include options above is on'))
		]));
		body.push(E('div', { 'class': 'oc-box' }, [
			E('div', { 'class': 'oc-box-title' }, '🧹 ' + _('Node filtering')),
			ocui.field(_('Keep nodes matching (regex)'), E('div', {}, [ f.filter, quick ])),
			E('div', { 'class': 'oc-grid' }, [ ocui.field(_('Drop nodes matching'), f.exFilter), ocui.field(_('Drop protocols'), f.exType) ])
		]));
		body.push(ocui.field(_('Child Proxies / Sub-Groups'), f.proxies, _('Click to add or remove; the order below is the order shown in the dashboard')));
		body.push(testBox, lbBox);
		body.push(E('div', { 'class': 'oc-grid' }, [ ocui.field(_('Group Icon URL'), f.icon), f.hidden ]));

		var read = function(base) {
			var o = clone(base);
			var setOrDel = function(k, v) { if (v === '' || v == null || (Array.isArray(v) && !v.length) || v === false) delete o[k]; else o[k] = v; };
			if (!opts.noName) o.name = (f.name.value || '').trim();
			o.type = f.type.value;
			setOrDel('icon', (f.icon.value || '').trim());
			setOrDel('include-all', f.includeAll.input.checked);
			setOrDel('include-all-providers', f.includeProv.input.checked);
			setOrDel('use', f.use.getValue());
			setOrDel('filter', (f.filter.value || '').trim());
			setOrDel('exclude-filter', (f.exFilter.value || '').trim());
			setOrDel('exclude-type', (f.exType.value || '').trim());
			setOrDel('proxies', f.proxies.getValue());
			setOrDel('hidden', f.hidden.input.checked);
			if (o.type === 'url-test' || o.type === 'fallback' || o.type === 'load-balance') {
				setOrDel('url', (f.url.value || '').trim());
				o.interval = parseInt(f.interval.value, 10) || 300;
				if (o.type === 'load-balance') delete o.tolerance; else o.tolerance = parseInt(f.tolerance.value, 10) || 0;
				o.lazy = f.lazy.input.checked;
			} else {
				[ 'url', 'interval', 'tolerance', 'lazy' ].forEach(function(k) { delete o[k]; });
			}
			if (o.type === 'load-balance') o.strategy = f.strategy.value; else delete o.strategy;
			return o;
		};
		return { body: body, read: read };
	},

	openGroup: function(idx) {
		var self = this, st = this.state;
		var isNew = idx < 0;
		var g = isNew ? { name: '', type: 'select', proxies: [ '🚀 节点选择', 'DIRECT' ] } : st.groups[idx];
		var form = this.groupForm(g);

		ocui.modal(isNew ? _('New Proxy Group') : _('Edit Proxy Group'), form.body, function() {
			var o = form.read(g);
			if (!o.name) { ui.addNotification(null, E('p', {}, _('Group name cannot be empty!')), 'error'); return false; }
			if (st.groups.some(function(x, i) { return x.name === o.name && i !== idx; }) || /^🌐 \d\d-出口$/.test(o.name)) {
				ui.addNotification(null, E('p', {}, _('Group name already exists')), 'error'); return false;
			}
			if (!(o.proxies && o.proxies.length) && !(o.use && o.use.length) && !o['include-all'] && !o['include-all-providers']) {
				ui.addNotification(null, E('p', {}, _('Pick at least one node source: child proxies, subscriptions or an include option.')), 'error'); return false;
			}
			if ((o.proxies || []).indexOf(o.name) >= 0) { ui.addNotification(null, E('p', {}, _('A group cannot contain itself.')), 'error'); return false; }

			/* 改名时同步更新所有引用它的地方 */
			if (!isNew && g.name !== o.name) {
				var from = g.name, to = o.name;
				var ren = function(arr) { return (arr || []).map(function(x) { return x === from ? to : x; }); };
				st.groups.forEach(function(x) { if (x.proxies) x.proxies = ren(x.proxies); });
				st.slotGroup.proxies = ren(st.slotGroup.proxies);
				st.apps.forEach(function(a) { if (a.target === from) a.target = to; });
				self.renderApps();
			}
			if (isNew) st.groups.push(o); else st.groups[idx] = o;
			self.markDirty();
			self.renderGroups();
		});
	},

	openSlotGroup: function() {
		var self = this, st = this.state;
		var form = this.groupForm(st.slotGroup, { noName: true });
		ocui.modal(_('Slot Exit Template'), [
			ocui.note(_('Applied to all 32 "🌐 NN-出口" groups. The exit bound to each slot is always moved to the first position automatically.'))
		].concat(form.body), function() {
			var o = form.read(st.slotGroup);
			delete o.name;
			if (!(o.proxies && o.proxies.length)) { ui.addNotification(null, E('p', {}, _('The slot template needs at least one candidate exit.')), 'error'); return false; }
			st.slotGroup = o;
			self.markDirty();
		});
	},

	resetGroups: function() {
		var self = this, st = this.state;
		if (!confirm(_('Are you sure you want to reset proxy groups to default template?\nThis will reset all dedicated lines, regions, and application groups.'))) return;
		callResetGroups().then(function(res) {
			ocui.ensureOk(res, _('Failed to reset proxy groups'));
			return callGetGroups();
		}).then(function(res) {
			st.groups = (res.groups || []).map(clone);
			st.slotGroup = clone(res.slot_group || st.slotGroup);
			self.renderGroups();
			ui.addNotification(null, E('p', {}, '✅ ' + _('Proxy groups successfully restored to default template!')), 'success');
		}).catch(function(err) { ui.addNotification(null, E('p', {}, err.message), 'error'); });
	},

	/* ==================== 应用分流卡片 ==================== */
	renderApps: function() {
		var self = this, st = this.state;
		var box = this._appsBox;
		box.innerHTML = '';

		var list = E('div', { 'class': 'oc-list' });
		var renderList = function() {
			list.innerHTML = '';
			var q = st.appQuery.toLowerCase();
			var shown = 0;
			st.apps.forEach(function(a, idx) {
				if (q) {
					var hay = [ a.name, a.id, a.target, a.desc ].concat((a.builtin_rules || []).concat(a.custom_rules || []).map(function(r) { return r.payload; })).join(' ').toLowerCase();
					if (hay.indexOf(q) < 0) return;
				}
				shown++;
				list.appendChild(self.appCard(a, idx));
			});
			if (!shown) list.appendChild(ocui.empty(st.apps.length ? _('No cards match the search.') : _('No application scenarios configured. Use "+ New Scenario Card" or "Reset to Defaults".')));
		};

		var search = E('input', { 'type': 'text', 'class': 'cbi-input-text oc-search', 'value': st.appQuery,
			'placeholder': '🔍 ' + _('Search card name, domain, IP or egress'),
			'input': function() { st.appQuery = (this.value || '').trim(); renderList(); } });

		box.appendChild(ocui.note([ E('b', {}, '🛡️ ' + _('Physical Line Isolation Guarantee') + '  '),
			_('Global-mode and targeted-mode WiFi devices are matched at the highest physical priority and always egress through their dedicated proxy. They never fall through to any application card below, preventing IP leaks and rule hijacking.') ], 'ok'));
		box.appendChild(ocui.head('🚀 ' + _('Application Routing Pipeline'), _('Rules are matched top to bottom. Use the arrows to change priority.'), [
			ocui.btn('▾ ' + _('Expand All'), function() { st.apps.forEach(function(a) { st.appOpen[a.id] = true; }); self.renderApps(); }),
			ocui.btn('▸ ' + _('Collapse All'), function() { st.appOpen = {}; self.renderApps(); }),
			ocui.btn('+ ' + _('New Scenario Card'), function() { self.openApp(-1); }, 'action'),
			ocui.btn('🔄 ' + _('Reset to Default Library'), function() { self.resetApps(); }, 'reset')
		]));
		box.appendChild(E('div', { 'class': 'oc-toolbar' }, E('div', { 'class': 'oc-grow' }, search)));
		box.appendChild(list);
		renderList();

		var cur = function(k, d) { return uci.get('omniclash', 'config', k) || d; };
		var sel = function(id, k, d) {
			return E('select', { 'id': id, 'class': 'cbi-input-select', 'change': function() { self.markDirty(); } },
				(function() { var o = self.targetOptions(); var v = cur(k, d); if (o.indexOf(v) < 0) o.unshift(v); return o; })().map(function(t) {
					return E('option', { 'value': t, 'selected': t === cur(k, d) ? 'selected' : null }, t);
				}));
		};
		box.appendChild(E('div', { 'class': 'oc-card', 'style': 'margin-top:16px' }, [
			E('div', { 'class': 'oc-row' }, [ E('b', {}, '⚓ ' + _('Baseline & Final Fallback')), E('span', { 'class': 'oc-desc', 'style': 'margin:0' }, _('These two rules are always emitted after every application card and cannot be reordered.')) ]),
			E('div', { 'class': 'oc-body', 'style': 'padding-left:12px' }, E('div', { 'class': 'oc-grid' }, [
				ocui.field(_('China Mainland Direct'), sel('set_cn_target', 'cn_target', 'DIRECT'), _('Emits GEOSITE,cn and GEOIP,cn to this target for all devices not captured above.')),
				ocui.field(_('Catch-All Fallback (MATCH)'), sel('set_final_target', 'final_target', '🚀 节点选择'), _('Terminal MATCH rule. Every remaining unmatched connection egresses through this target.'))
			]))
		]));
	},

	ruleTag: function(r, onRemove, onEdit) {
		var bad = this.ruleProblem(r);
		var kids = [ E('b', {}, r.type), ' ', r.payload ];
		if (onRemove) kids.push(E('button', { 'type': 'button', 'class': 'oc-x', 'title': _('Remove'), 'click': function(ev) { ev.stopPropagation(); onRemove(); } }, '×'));
		var t = ocui.tag(kids, bad ? 'err' : null, true);
		if (bad) t.title = bad;
		if (onEdit) { t.style.cursor = 'pointer'; t.addEventListener('click', onEdit); }
		return t;
	},

	ruleProblem: function(r) {
		var st = this.state;
		var t = (r.type || '').toUpperCase(), p = (r.payload || '').toLowerCase();
		if (RULE_TYPES.indexOf(t) < 0) return _('Unsupported rule type');
		if (t === 'GEOSITE' && st.geosite.length && st.geosite.indexOf(p) < 0) return _('GEOSITE tag not found in local geodata');
		if (t === 'GEOIP' && st.geoip.length && st.geoip.indexOf(p) < 0) return _('GEOIP tag not found in local geodata');
		return null;
	},

	appCard: function(a, idx) {
		var self = this, st = this.state;
		var on = isEnabled(a.enabled);
		var open = !!st.appOpen[a.id];
		var builtin = a.builtin_rules || [], custom = a.custom_rules || [];
		var problems = builtin.concat(custom).filter(function(r) { return self.ruleProblem(r); }).length;

		var target = E('select', { 'class': 'cbi-input-select', 'style': 'width:auto;max-width:200px', 'change': function() { a.target = this.value; self.markDirty(); } },
			(function() { var o = self.targetOptions(); if (a.target && o.indexOf(a.target) < 0) o.unshift(a.target); return o; })().map(function(t) {
				return E('option', { 'value': t, 'selected': t === a.target ? 'selected' : null }, t);
			}));
		var toggle = E('input', { 'type': 'checkbox', 'checked': on ? 'checked' : null, 'title': _('Enable this scenario'),
			'change': function() { a.enabled = this.checked; self.markDirty(); self.renderApps(); } });

		var header = E('div', { 'class': 'oc-row' }, [
			E('div', { 'class': 'oc-row-main', 'style': 'cursor:pointer', 'click': function(ev) {
				if (ev.target.closest('select,input,button')) return;
				st.appOpen[a.id] = !open; self.renderApps();
			} }, [
				E('span', { 'class': 'oc-idx' }, open ? '▾' : '▸'),
				E('div', { 'style': 'min-width:0;flex:1' }, [
					E('div', { 'class': 'oc-title' }, a.name || a.id),
					E('div', { 'class': 'oc-sub' }, [
						ocui.tag(_('%d rules').format(builtin.length + custom.length), 'pri'),
						custom.length ? ocui.tag(_('%d custom').format(custom.length), 'ok') : '',
						problems ? ocui.tag('⚠ ' + _('%d invalid').format(problems), 'err') : '',
						a.is_custom ? ocui.tag(_('custom card'), 'vio') : ''
					])
				])
			]),
			E('div', { 'class': 'oc-row-side' }, [
				E('span', { 'class': 'oc-desc', 'style': 'margin:0' }, _('Egress')), target,
				E('label', { 'style': 'display:inline-flex;align-items:center;gap:4px;margin:0 4px' }, [ toggle, _('On') ]),
				ocui.btn('↑', function() { self.moveItem(st.apps, idx, -1); self.renderApps(); }, null, { 'disabled': idx === 0 ? 'disabled' : null, 'title': _('Move Up') }),
				ocui.btn('↓', function() { self.moveItem(st.apps, idx, 1); self.renderApps(); }, null, { 'disabled': idx === st.apps.length - 1 ? 'disabled' : null, 'title': _('Move Down') }),
				ocui.btn('⚙️', function() { self.openApp(idx); }, null, { 'title': _('Edit') })
			])
		]);

		var kids = [ header ];
		if (open) {
			var body = [];
			if (a.desc) body.push(E('div', { 'class': 'oc-desc' }, a.desc));
			var section = function(title, rules, key) {
				body.push(E('div', { 'class': 'oc-desc', 'style': 'margin:6px 0 4px;font-weight:600' }, title + ' (' + rules.length + ')'));
				body.push(rules.length ? E('div', { 'class': 'oc-tags is-scroll' }, rules.map(function(r, ri) {
					return self.ruleTag(r,
						function() { a[key].splice(ri, 1); self.markDirty(); self.renderApps(); },
						function() { self.openRule(a, key, ri); });
				})) : E('div', { 'class': 'oc-desc' }, _('None')));
			};
			section(_('Built-in Rules'), builtin, 'builtin_rules');
			section(_('Custom Rules'), custom, 'custom_rules');
			body.push(E('div', { 'class': 'oc-toolbar', 'style': 'margin:10px 0 0' }, [
				ocui.btn('+ ' + _('Add rule'), function() { self.openRule(a, 'custom_rules', -1); }, 'action'),
				ocui.btn('📋 ' + _('Batch Import'), function() { self.openBatch(a); })
			]));
			kids.push(E('div', { 'class': 'oc-body' }, body));
		}
		return E('div', { 'class': 'oc-card has-accent' + (on ? '' : ' is-off') }, kids);
	},

	ruleEditor: function(r) {
		var st = this.state;
		var type = ocui.select(RULE_TYPES, (r.type || 'DOMAIN-SUFFIX').toUpperCase(), true);
		var payload = ocui.input(r.payload, RULE_HINTS[type.value], { mono: true });
		var listId = 'oc_geo_' + Math.random().toString(36).slice(2);
		var dl = E('datalist', { 'id': listId });
		var resolve = ocui.check(_('Allow DNS resolution for this rule'), r.resolve === true, _('Off by default for IP rules (adds no-resolve)'));
		var sync = function() {
			payload.placeholder = RULE_HINTS[type.value] || '';
			dl.innerHTML = '';
			var src = type.value === 'GEOSITE' ? st.geosite : (type.value === 'GEOIP' ? st.geoip : []);
			src.forEach(function(t) { dl.appendChild(E('option', { 'value': t })); });
			payload.setAttribute('list', src.length ? listId : '');
			resolve.style.display = /^(GEOIP|IP-CIDR6?|IP-ASN)$/.test(type.value) ? '' : 'none';
		};
		type.addEventListener('change', sync);
		sync();
		return {
			body: [ E('div', { 'class': 'oc-grid is-2' }, [ ocui.field(_('Rule Type'), type), E('div') ]), ocui.field(_('Match value'), E('div', {}, [ payload, dl ])), resolve ],
			read: function() {
				var o = { type: type.value, payload: (payload.value || '').trim() };
				if (resolve.input.checked && resolve.style.display !== 'none') o.resolve = true;
				return o;
			}
		};
	},

	openRule: function(a, key, ri) {
		var self = this;
		if (!a[key]) a[key] = [];
		var isNew = ri < 0;
		var ed = this.ruleEditor(isNew ? { type: 'DOMAIN-SUFFIX', payload: '' } : a[key][ri]);
		ocui.modal((isNew ? _('Add rule to') : _('Edit rule in')) + ' ' + (a.name || a.id), ed.body, function() {
			var r = ed.read();
			if (!r.payload) { ui.addNotification(null, E('p', {}, _('Please enter a domain or IP first.')), 'error'); return false; }
			var bad = self.ruleProblem(r);
			if (bad && !confirm(bad + '\n' + _('Save anyway? Saving the whole page will be rejected until it is fixed.'))) return false;
			if (isNew) a[key].push(r); else a[key][ri] = r;
			self.state.appOpen[a.id] = true;
			self.markDirty();
			self.renderApps();
		});
	},

	openBatch: function(a) {
		var self = this;
		var type = ocui.select(RULE_TYPES, 'DOMAIN-SUFFIX');
		var text = E('textarea', { 'class': 'cbi-input-textarea oc-mono', 'rows': 8, 'style': 'width:100%;box-sizing:border-box', 'placeholder': 'example.com\nDOMAIN-KEYWORD,tracker\nIP-CIDR,1.2.3.0/24' });
		ocui.modal(_('Batch Import') + ' — ' + (a.name || a.id), [
			ocui.field(_('Default Type:'), type, _('Used for lines that do not start with a rule type')),
			ocui.field(_('One rule per line'), text, _('Lines starting with # are ignored. Duplicates are skipped.'))
		], function() {
			if (!a.custom_rules) a.custom_rules = [];
			var have = {};
			(a.builtin_rules || []).concat(a.custom_rules).forEach(function(r) { have[r.type + ',' + r.payload] = true; });
			var added = 0, skipped = 0;
			(text.value || '').split('\n').forEach(function(line) {
				var raw = line.trim();
				if (!raw || raw.charAt(0) === '#' || raw.indexOf('//') === 0) return;
				var t = type.value, p = raw;
				var m = raw.match(/^([A-Za-z0-9-]+)\s*,\s*(.+)$/);
				if (m && RULE_TYPES.indexOf(m[1].toUpperCase()) >= 0) {
					t = m[1].toUpperCase();
					/* 粘贴的完整规则可能带出口或 no-resolve 尾巴，只保留匹配值（复合规则 AND/OR/NOT 原样保留） */
					p = /^(AND|OR|NOT)$/.test(t) ? m[2].trim() : m[2].split(',')[0].trim();
				}
				if (have[t + ',' + p]) { skipped++; return; }
				have[t + ',' + p] = true;
				a.custom_rules.push({ type: t, payload: p });
				added++;
			});
			self.state.appOpen[a.id] = true;
			self.markDirty();
			self.renderApps();
			ui.addNotification(null, E('p', {}, _('Imported %d rules, skipped %d duplicates.').format(added, skipped)), 'info');
		}, _('Import'));
	},

	openApp: function(idx) {
		var self = this, st = this.state;
		var isNew = idx < 0;
		var a = isNew ? { id: '', name: '', desc: '', target: '🚀 节点选择', builtin_rules: [], custom_rules: [], enabled: true, is_custom: true } : st.apps[idx];
		var name = ocui.input(a.name, _('e.g. Company Office'));
		var desc = ocui.input(a.desc, _('Optional description'));
		var target = ocui.select(this.targetOptions(), a.target, true);
		var first = isNew ? this.ruleEditor({ type: 'DOMAIN-SUFFIX', payload: '' }) : null;

		var body = [ ocui.field(_('Scenario Name'), name), ocui.field(_('Description'), desc), ocui.field(_('Egress Target'), target) ];
		if (first) body.push(E('div', { 'class': 'oc-box' }, [ E('div', { 'class': 'oc-box-title' }, _('First rule (optional)')) ].concat(first.body)));

		ocui.modal(isNew ? _('New Scenario Card') : _('Edit Scenario Card'), body, function() {
			var n = (name.value || '').trim();
			if (!n) { ui.addNotification(null, E('p', {}, _('Scenario name cannot be empty.')), 'error'); return false; }
			a.name = n;
			a.desc = (desc.value || '').trim();
			a.target = target.value;
			if (isNew) {
				var base = 'custom_' + (n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'card'), id = base, i = 2;
				while (st.apps.some(function(x) { return x.id === id; })) id = base + '_' + (i++);
				a.id = id;
				var r = first.read();
				if (r.payload) a.custom_rules.push(r);
				st.apps.push(a);
				st.appOpen[id] = true;
			}
			self.markDirty();
			self.renderApps();
		});

		if (!isNew && a.is_custom === true) {
			var actions = document.querySelector('.modal .oc-actions');
			if (actions) actions.insertBefore(E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-remove', 'style': 'margin-right:auto', 'click': function() {
				if (!confirm(_('Delete card "%s"?').replace('%s', a.name))) return;
				st.apps.splice(idx, 1); ui.hideModal(); self.markDirty(); self.renderApps();
			} }, _('Delete card')), actions.firstChild);
		}
	},

	resetApps: function() {
		var self = this, st = this.state;
		if (!confirm(_('Are you sure you want to restore the full default application library?\nAll custom scenarios and custom rules will be discarded.'))) return;
		callResetApps().then(function(res) {
			ocui.ensureOk(res, _('Failed to restore default application library'));
			return callGetApps();
		}).then(function(res) {
			st.apps = (res.apps || []).map(clone);
			st.appOpen = {};
			self.renderApps();
			ui.addNotification(null, E('p', {}, '✅ ' + _('Default application library restored successfully!')), 'success');
		}).catch(function(err) { ui.addNotification(null, E('p', {}, err.message), 'error'); });
	},

	/* ==================== 运行配置 ==================== */
	renderRunConfig: function() {
		var self = this;
		var area = E('textarea', { 'class': 'cbi-input-textarea oc-mono', 'readonly': 'readonly',
			'style': 'width:100%;height:560px;font-size:12px;line-height:1.45;box-sizing:border-box' }, this.state.runConfig);
		this._runArea = area;
		return E('div', {}, [
			ocui.head(_('Final Compiled Configuration (/etc/omniclash/run/config.yaml)'),
				_('Dynamically compiled from settings, providers, groups, rules, and 32-WiFi matrix (read-only).'), [
					ocui.btn('🔄 ' + _('Refresh Config'), function() { self.refreshRunConfig(); }, 'action'),
					ocui.btn('📋 ' + _('Copy All'), function() {
						if (navigator.clipboard) navigator.clipboard.writeText(area.value).then(function() {
							ui.addNotification(null, E('p', {}, '✅ ' + _('Running configuration copied to clipboard!')), 'success');
						});
					})
				]),
			area
		]);
	},

	refreshRunConfig: function() {
		var area = this._runArea;
		return fs.read('/etc/omniclash/run/config.yaml').then(function(txt) { if (area) area.value = txt || ''; });
	},

	/* ==================== 备份 ==================== */
	exportBackup: function() {
		callExportBackup().then(function(res) {
			ocui.ensureOk(res, _('Failed to export backup'));
			var blob = new Blob([ JSON.stringify(res.backup || {}, null, 2) ], { type: 'application/json' });
			var url = URL.createObjectURL(blob);
			var a = E('a', { 'href': url, 'download': 'omniclash-backup-' + new Date().toISOString().slice(0, 10) + '.json' });
			document.body.appendChild(a); a.click(); document.body.removeChild(a);
			setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
			ui.addNotification(null, E('p', {}, '✅ ' + _('Configuration backup exported successfully!')), 'success');
		}).catch(function(err) { ui.addNotification(null, E('p', {}, err.message), 'error'); });
	},

	importBackup: function(ev) {
		var file = ev.target.files && ev.target.files[0];
		ev.target.value = '';
		if (!file) return;
		var reader = new FileReader();
		reader.onload = function(e) {
			var parsed = null;
			try { parsed = JSON.parse(e.target.result); } catch (err) {}
			if (!parsed || parsed.app !== 'omniclash' || !parsed.data) {
				ui.addNotification(null, E('p', {}, _('Invalid backup file: not an OmniClash backup archive')), 'error');
				return;
			}
			var when = parsed.exported_at ? new Date(parsed.exported_at * 1000).toLocaleString() : '-';
			if (!confirm(_('Restore the backup exported at %s from %s?\nCurrent slots, groups, cards and subscriptions will be replaced. If the restored configuration fails validation, nothing is changed.').format(when, parsed.hostname || '-'))) return;
			ui.showModal(_('Restoring Configuration'), [ E('p', { 'class': 'spinning' }, _('Restoring configuration files, recompiling rules, and seamlessly reloading...')) ]);
			callImportBackup(parsed).then(function(res) {
				ui.hideModal();
				ocui.ensureOk(res, _('Failed to restore configuration'));
				ui.addNotification(null, E('p', {}, '✅ ' + res.msg), 'success');
				setTimeout(function() { window.location.reload(); }, 1200);
			}).catch(function(err) { ui.hideModal(); ui.addNotification(null, E('p', {}, err.message), 'error'); });
		};
		reader.readAsText(file);
	},

	/* ==================== 统一保存 ==================== */
	saveAll: function() {
		var self = this, st = this.state;
		var bad = [];
		st.apps.forEach(function(a) {
			(a.builtin_rules || []).concat(a.custom_rules || []).forEach(function(r) {
				var p = self.ruleProblem(r);
				if (p) bad.push((a.name || a.id) + ': ' + r.type + ',' + r.payload + ' — ' + p);
			});
		});
		if (bad.length) {
			ui.addNotification(null, E('div', {}, [ E('p', {}, _('Fix these rules before saving:')), E('ul', {}, bad.slice(0, 8).map(function(x) { return E('li', {}, x); })) ]), 'error');
			return;
		}

		ui.showModal(_('Saving & Applying'), [ E('p', { 'class': 'spinning' }, _('Validating, compiling and hot-reloading. If anything fails, every file is rolled back.')) ]);
		/* 订阅携带 raw（模板里的原始对象），引擎以它为底合并表单字段，保证未在 UI 暴露的选项不丢失 */
		callSaveAll(this.collectSettings(), st.providers, st.groups, st.slotGroup, st.apps).then(function(res) {
			ocui.ensureOk(res, _('Save failed'));
			uci.unload('omniclash');
			return Promise.all([ uci.load('omniclash'), callGetProviders(), callGetGroups(), callGetApps() ]).then(function(r) {
				return Promise.resolve().then(function() {
					st.providers = (r[1].providers || []).map(clone);
					st.groups = (r[2].groups || []).map(clone);
					st.slotGroup = clone(r[2].slot_group || st.slotGroup);
					st.apps = (r[3].apps || []).map(clone);
					st.dirty = false;
					var bar = document.getElementById('oc_dirty');
					if (bar) bar.style.display = 'none';
					self.renderProviders(); self.renderGroups(); self.renderApps();
					return self.refreshRunConfig();
				});
			});
		}).then(function() {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, '✅ ' + _('All settings, providers, groups, and application cards successfully saved and applied!')), 'success');
		}).catch(function(err) {
			ui.hideModal();
			ui.addNotification(null, E('div', {}, [ E('p', {}, E('b', {}, _('Nothing was changed. The router is still running the previous configuration.'))), E('p', {}, err.message) ]), 'error');
		});
	}
});
