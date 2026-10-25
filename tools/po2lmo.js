#!/usr/bin/env node
'use strict';

/**
 * po2lmo.js - 100% Bit-Exact PO to LMO Compiler for OpenWrt LuCI.
 * Directly utilizes LuCI cbi.js hash function to guarantee 100% hash parity in browser.
 */

const fs = require('fs');

function s8(bytes, off) {
	var n = bytes[off];
	return (n > 0x7F) ? (n - 256) >>> 0 : n;
}

function u16(bytes, off) {
	return ((bytes[off + 1] << 8) + bytes[off]) >>> 0;
}

function sfh(s) {
	if (s === null || s.length === 0) return 0;
	var bytes = [];
	for (var i = 0; i < s.length; i++) {
		var ch = s.charCodeAt(i);
		if (ch <= 0x7F)
			bytes.push(ch);
		else if (ch <= 0x7FF)
			bytes.push(((ch >>> 6) & 0x1F) | 0xC0, (ch & 0x3F) | 0x80);
		else if (ch <= 0xFFFF)
			bytes.push(((ch >>> 12) & 0x0F) | 0xE0, ((ch >>> 6) & 0x3F) | 0x80, (ch & 0x3F) | 0x80);
		else
			bytes.push(((ch >>> 18) & 0x07) | 0xF0, ((ch >>> 12) & 0x3F) | 0x80, ((ch >> 6) & 0x3F) | 0x80, (ch & 0x3F) | 0x80);
	}
	if (!bytes.length) return 0;
	var hash = (bytes.length >>> 0), len = (bytes.length >>> 2), off = 0, tmp;
	while (len--) {
		hash += u16(bytes, off);
		tmp = ((u16(bytes, off + 2) << 11) ^ hash) >>> 0;
		hash = ((hash << 16) ^ tmp) >>> 0;
		hash += hash >>> 11;
		off += 4;
	}
	switch ((bytes.length & 3) >>> 0) {
		case 3:
			hash += u16(bytes, off);
			hash = (hash ^ (hash << 16)) >>> 0;
			hash = (hash ^ (s8(bytes, off + 2) << 18)) >>> 0;
			hash += hash >>> 11;
			break;
		case 2:
			hash += u16(bytes, off);
			hash = (hash ^ (hash << 11)) >>> 0;
			hash += hash >>> 17;
			break;
		case 1:
			hash += s8(bytes, off);
			hash = (hash ^ (hash << 10)) >>> 0;
			hash += hash >>> 1;
			break;
	}
	hash = (hash ^ (hash << 3)) >>> 0;
	hash += hash >>> 5;
	hash = (hash ^ (hash << 4)) >>> 0;
	hash += hash >>> 17;
	hash = (hash ^ (hash << 25)) >>> 0;
	hash += hash >>> 6;
	return hash >>> 0;
}

function parsePo(filepath) {
	const content = fs.readFileSync(filepath, 'utf8');
	const lines = content.split('\n');
	const entries = [];
	let curMsgid = null;
	let curMsgstr = null;
	let state = null;

	function unescapePo(s) {
		if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
		return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
	}

	for (let line of lines) {
		line = line.trim();
		if (!line || line.startsWith('#')) {
			if (curMsgid !== null && curMsgstr !== null) {
				entries.push({ id: curMsgid, str: curMsgstr });
				curMsgid = null;
				curMsgstr = null;
				state = null;
			}
			continue;
		}

		if (line.startsWith('msgid ')) {
			if (curMsgid !== null && curMsgstr !== null) {
				entries.push({ id: curMsgid, str: curMsgstr });
				curMsgid = null;
				curMsgstr = null;
			}
			curMsgid = unescapePo(line.slice(6).trim());
			state = 'msgid';
		} else if (line.startsWith('msgstr ')) {
			curMsgstr = unescapePo(line.slice(7).trim());
			state = 'msgstr';
		} else if (line.startsWith('"')) {
			const val = unescapePo(line);
			if (state === 'msgid' && curMsgid !== null) curMsgid += val;
			else if (state === 'msgstr' && curMsgstr !== null) curMsgstr += val;
		}
	}

	if (curMsgid !== null && curMsgstr !== null) {
		entries.push({ id: curMsgid, str: curMsgstr });
	}

	return entries;
}

function compileLmo(poFile, lmoFile) {
	const entries = parsePo(poFile);
	const dataBuffers = [];
	let dataLen = 0;
	const indexEntries = [];

	for (const e of entries) {
		if (!e.id || !e.str) continue;
		const keyHash = sfh(e.id);
		const strBuf = Buffer.from(e.str, 'utf8');
		const offset = dataLen;
		const length = strBuf.length;

		dataBuffers.push(strBuf);
		dataLen += length;

		// 4-byte padding
		const pad = (4 - (dataLen % 4)) % 4;
		if (pad > 0) {
			dataBuffers.push(Buffer.alloc(pad));
			dataLen += pad;
		}

		indexEntries.push({ key: keyHash, valId: 1, offset: offset, length: length });
	}

	// LMO requires index table sorted ascending by key
	indexEntries.sort((a, b) => (a.key < b.key ? -1 : (a.key > b.key ? 1 : 0)));

	const indexBuf = Buffer.alloc(indexEntries.length * 16 + 4);
	let ioff = 0;
	for (const ie of indexEntries) {
		indexBuf.writeUInt32BE(ie.key, ioff);
		indexBuf.writeUInt32BE(ie.valId, ioff + 4);
		indexBuf.writeUInt32BE(ie.offset, ioff + 8);
		indexBuf.writeUInt32BE(ie.length, ioff + 12);
		ioff += 16;
	}

	// Final 4 bytes: byte offset where index table starts
	indexBuf.writeUInt32BE(dataLen, ioff);

	const finalBuf = Buffer.concat([...dataBuffers, indexBuf]);
	fs.writeFileSync(lmoFile, finalBuf);
	console.log(`Compiled ${indexEntries.length} translations to ${lmoFile} (${finalBuf.length} bytes)`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
	console.log('Usage: node po2lmo.js <input.po> <output.lmo>');
	process.exit(1);
}

compileLmo(args[0], args[1]);
