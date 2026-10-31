'use strict';
'require baseclass';
'require ui';

/* OmniClash 共享前端组件：样式加载、深色检测，以及各页面复用的卡片、标签、表单与弹窗构件。
 * 页面通过 'require omniclash.ui as ocui' 引入。 */

var CSS_ID = 'omniclash-ui-css';

function isDarkBg() {
	var el = document.body;
	var bg = '';
	while (el) {
		bg = window.getComputedStyle(el).backgroundColor;
		if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)/.test(bg)) break;
		el = el.parentElement;
	}
	var m = (bg || '').match(/\d+(\.\d+)?/g);
	if (!m || m.length < 3) return false;
	var lum = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
	return lum < 0.45;
}

function syncTheme() {
	document.documentElement.classList.toggle('oc-dark', isDarkBg());
}

return baseclass.extend({
	init: function() {
		if (!document.getElementById(CSS_ID)) {
			var link = document.createElement('link');
			link.id = CSS_ID;
			link.rel = 'stylesheet';
			link.href = L.resource('omniclash/ui.css') + '?v=' + (L.env.sessionid ? L.env.sessionid.slice(0, 6) : '1');
			document.head.appendChild(link);
		}
		syncTheme();
		if (window.matchMedia)
			window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
		setTimeout(syncTheme, 300);
	},

	/* 页面根容器：所有子元素继承 .oc 的颜色变量 */
	root: function(children) {
		return E('div', { 'class': 'cbi-map oc' }, children);
	},

	head: function(title, desc, actions) {
		return E('div', { 'class': 'oc-head' }, [
			E('div', {}, [ E('h3', {}, title), desc ? E('p', {}, desc) : '' ]),
			actions ? E('div', { 'class': 'oc-toolbar', 'style': 'margin:0' }, actions) : ''
		]);
	},

	/* 子标签页：tabs = [{ id, label, content }]，记住上次打开的标签 */
	tabs: function(storeKey, tabs) {
		var saved = null;
		try { saved = window.localStorage.getItem(storeKey); } catch (e) {}
		var active = tabs.some(function(t) { return t.id === saved; }) ? saved : tabs[0].id;
		var bar = E('div', { 'class': 'oc-tabs' });
		var panes = [];
		var btns = [];
		var select = function(id) {
			btns.forEach(function(b) { b.classList.toggle('is-active', b.dataset.id === id); });
			panes.forEach(function(p) { p.classList.toggle('is-active', p.dataset.id === id); });
			try { window.localStorage.setItem(storeKey, id); } catch (e) {}
		};
		tabs.forEach(function(t) {
			var b = E('button', { 'type': 'button', 'class': 'oc-tab', 'data-id': t.id, 'click': function() { select(t.id); } }, t.label);
			btns.push(b);
			bar.appendChild(b);
			panes.push(E('div', { 'class': 'oc-pane', 'data-id': t.id }, t.content));
		});
		select(active);
		return [ bar ].concat(panes);
	},

	btn: function(label, onclick, kind, extra) {
		var cls = 'cbi-button oc-sm' + (kind ? ' cbi-button-' + kind : '');
		var attrs = { 'type': 'button', 'class': cls, 'click': onclick };
		if (extra) for (var k in extra) attrs[k] = extra[k];
		return E('button', attrs, label);
	},

	tag: function(content, kind, mono) {
		return E('span', { 'class': 'oc-tag' + (kind ? ' is-' + kind : '') + (mono ? ' is-mono' : '') }, content);
	},

	chips: function(items, active, onpick) {
		return E('div', { 'class': 'oc-chips' }, items.map(function(it) {
			return E('button', {
				'type': 'button',
				'class': 'oc-chip' + (it.id === active ? ' is-active' : ''),
				'click': function() { onpick(it.id); }
			}, [ it.label, it.count != null ? E('span', { 'class': 'oc-count' }, it.count) : '' ]);
		}));
	},

	empty: function(text) {
		return E('div', { 'class': 'oc-empty' }, text);
	},

	note: function(content, kind) {
		return E('div', { 'class': 'oc-note' + (kind ? ' is-' + kind : '') }, content);
	},

	icon: function(url, fallback) {
		if (url && /^https?:\/\//.test(url))
			return E('img', { 'class': 'oc-icon', 'src': url, 'loading': 'lazy', 'alt': '' });
		return E('span', { 'class': 'oc-icon-txt' }, url || fallback || '•');
	},

	/* 表单字段 */
	field: function(label, control, hint) {
		return E('div', { 'class': 'oc-field' }, [ E('label', {}, label), control, hint ? E('div', { 'class': 'oc-hint' }, hint) : '' ]);
	},

	check: function(label, checked, hint) {
		var cb = E('input', { 'type': 'checkbox', 'checked': checked ? 'checked' : null });
		var f = E('div', { 'class': 'oc-field is-check' }, [ E('label', {}, [ cb, label ]), hint ? E('div', { 'class': 'oc-hint' }, hint) : '' ]);
		f.input = cb;
		return f;
	},

	input: function(value, placeholder, opts) {
		opts = opts || {};
		return E('input', {
			'type': opts.type || 'text',
			'class': 'cbi-input-text' + (opts.mono ? ' oc-mono' : ''),
			'value': value == null ? '' : value,
			'placeholder': placeholder || ''
		});
	},

	select: function(options, value, allowCustom) {
		var opts = options.slice();
		if (allowCustom && value && opts.indexOf(value) < 0) opts.unshift(value);
		return E('select', { 'class': 'cbi-input-select' }, opts.map(function(o) {
			var v = (typeof o === 'object') ? o.value : o;
			var l = (typeof o === 'object') ? o.label : o;
			return E('option', { 'value': v, 'selected': v === value ? 'selected' : null }, l);
		}));
	},

	/* 有序多选：上半部分点选候选项，下半部分对已选项排序。
	 * 返回的元素带 getValue()，读取当前顺序。 */
	orderedPicker: function(candidates, selected) {
		var sel = (selected || []).slice();
		var wrap = E('div', {});
		var pick = E('div', { 'class': 'oc-pick' });
		var order = E('div', { 'class': 'oc-order' });
		var all = candidates.slice();
		sel.forEach(function(s) { if (all.indexOf(s) < 0) all.push(s); });

		var render = function() {
			pick.innerHTML = '';
			all.forEach(function(c) {
				var on = sel.indexOf(c) >= 0;
				pick.appendChild(E('span', { 'class': on ? 'is-on' : '', 'click': function() {
					var i = sel.indexOf(c);
					if (i >= 0) sel.splice(i, 1); else sel.push(c);
					render();
				} }, (on ? '✓ ' : '+ ') + c));
			});
			order.innerHTML = '';
			sel.forEach(function(c, i) {
				order.appendChild(E('div', { 'class': 'oc-order-item' }, [
					E('span', { 'class': 'oc-idx' }, i + 1),
					E('span', { 'class': 'oc-grow' }, c),
					E('button', { 'type': 'button', 'class': 'cbi-button oc-sm oc-icon-btn', 'disabled': i === 0 ? 'disabled' : null,
						'click': function() { sel.splice(i - 1, 0, sel.splice(i, 1)[0]); render(); } }, '↑'),
					E('button', { 'type': 'button', 'class': 'cbi-button oc-sm oc-icon-btn', 'disabled': i === sel.length - 1 ? 'disabled' : null,
						'click': function() { sel.splice(i + 1, 0, sel.splice(i, 1)[0]); render(); } }, '↓'),
					E('button', { 'type': 'button', 'class': 'cbi-button oc-sm oc-icon-btn cbi-button-remove',
						'click': function() { sel.splice(i, 1); render(); } }, '×')
				]));
			});
			if (!sel.length) order.appendChild(E('div', { 'class': 'oc-hint' }, _('Nothing selected')));
		};
		render();
		wrap.appendChild(pick);
		wrap.appendChild(order);
		wrap.getValue = function() { return sel.slice(); };
		return wrap;
	},

	/* 弹窗：body 为内容节点，onsave 返回 false 表示不关闭 */
	modal: function(title, body, onsave, saveLabel) {
		ui.showModal(title, E('div', { 'class': 'oc' }, [
			E('div', { 'class': 'oc-form' }, body),
			E('div', { 'class': 'oc-actions', 'style': 'margin-top:16px' }, [
				E('button', { 'type': 'button', 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')),
				onsave ? E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-apply', 'click': function() {
					if (onsave() !== false) ui.hideModal();
				} }, saveLabel || _('Save')) : ''
			])
		]));
	},

	/* 把 RPC 返回的错误统一转成异常 */
	ensureOk: function(res, fallback) {
		if (!res || res.success === false)
			throw new Error((res && res.error) || fallback || _('Operation failed'));
		return res;
	}
});
