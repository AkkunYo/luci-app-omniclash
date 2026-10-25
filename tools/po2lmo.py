#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
po2lmo.py - Standalone PO to LMO (Lua Machine Objects) compiler for OpenWrt LuCI.
Compatible with OpenWrt po2lmo specifications.
"""

import sys
import struct

def sfh_hash(s):
    """
    SuperFastHash algorithm used by LuCI LMO and cbi.js.
    """
    if not s:
        return 0
    # Trim whitespace according to LuCI gettext convention: trimws(s)
    normalized = " ".join(s.strip().replace("\r\n", "\n").split())
    b = list(normalized.encode("utf-8"))
    length = len(b)
    if length == 0:
        return 0

    def u16(off):
        return b[off] | (b[off + 1] << 8)

    def s8(off):
        n = b[off]
        return (n - 256) if n > 0x7F else n

    h = length
    blocks = length >> 2
    off = 0
    for _ in range(blocks):
        h = (h + u16(off)) & 0xFFFFFFFF
        tmp = ((u16(off + 2) << 11) ^ h) & 0xFFFFFFFF
        h = ((h << 16) ^ tmp) & 0xFFFFFFFF
        h = (h + (h >> 11)) & 0xFFFFFFFF
        off += 4

    rem = length & 3
    if rem == 3:
        h = (h + u16(off)) & 0xFFFFFFFF
        h = (h ^ (h << 16)) & 0xFFFFFFFF
        h = (h ^ ((s8(off + 2) << 18) & 0xFFFFFFFF)) & 0xFFFFFFFF
        h = (h + (h >> 11)) & 0xFFFFFFFF
    elif rem == 2:
        h = (h + u16(off)) & 0xFFFFFFFF
        h = (h ^ (h << 11)) & 0xFFFFFFFF
        h = (h ^ (h >> 17)) & 0xFFFFFFFF
    elif rem == 1:
        h = (h + s8(off)) & 0xFFFFFFFF
        h = (h ^ (h << 10)) & 0xFFFFFFFF
        h = (h + (h >> 1)) & 0xFFFFFFFF

    h = (h ^ (h << 3)) & 0xFFFFFFFF
    h = (h + (h >> 5)) & 0xFFFFFFFF
    h = (h ^ (h << 4)) & 0xFFFFFFFF
    h = (h + (h >> 17)) & 0xFFFFFFFF
    h = (h ^ (h << 25)) & 0xFFFFFFFF
    h = (h + (h >> 6)) & 0xFFFFFFFF
    return h


def parse_po_file(filepath):
    """
    Parses a PO file and extracts (msgid, msgstr) pairs.
    """
    entries = []
    cur_msgid = None
    cur_msgstr = None
    state = None

    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line_str = line.strip()
            if not line_str or line_str.startswith("#"):
                if cur_msgid is not None and cur_msgstr is not None:
                    entries.append((cur_msgid, cur_msgstr))
                    cur_msgid = None
                    cur_msgstr = None
                    state = None
                continue

            if line_str.startswith("msgid "):
                if cur_msgid is not None and cur_msgstr is not None:
                    entries.append((cur_msgid, cur_msgstr))
                    cur_msgid = None
                    cur_msgstr = None
                cur_msgid = unescape_po_string(line_str[6:].strip())
                state = "msgid"
            elif line_str.startswith("msgstr "):
                cur_msgstr = unescape_po_string(line_str[7:].strip())
                state = "msgstr"
            elif line_str.startswith('"'):
                val = unescape_po_string(line_str)
                if state == "msgid" and cur_msgid is not None:
                    cur_msgid += val
                elif state == "msgstr" and cur_msgstr is not None:
                    cur_msgstr += val

    if cur_msgid is not None and cur_msgstr is not None:
        entries.append((cur_msgid, cur_msgstr))

    return entries


def unescape_po_string(s):
    if s.startswith('"') and s.endswith('"'):
        s = s[1:-1]
    return s.replace(r'\\', '\\').replace(r'\"', '"').replace(r'\n', '\n').replace(r'\t', '\t').replace(r'\r', '\r')


def compile_to_lmo(entries, out_path):
    """
    Compiles list of (msgid, msgstr) to an LMO binary file.
    """
    data_bytes = bytearray()
    index_entries = []

    for msgid, msgstr in entries:
        if not msgid or not msgstr:
            continue
        key_id = sfh_hash(msgid)
        encoded_str = msgstr.encode("utf-8")
        str_offset = len(data_bytes)
        str_len = len(encoded_str)

        data_bytes.extend(encoded_str)
        # Pad string to 4-byte boundary
        pad = (4 - (len(data_bytes) % 4)) % 4
        data_bytes.extend(b"\x00" * pad)

        index_entries.append((key_id, 1, str_offset, str_len))

    # LMO requires index table sorted ascending by key_id
    index_entries.sort(key=lambda x: x[0])

    index_offset = len(data_bytes)
    for key_id, val_id, str_offset, str_len in index_entries:
        data_bytes.extend(struct.pack(">IIII", key_id, val_id, str_offset, str_len))

    # Final 4 bytes: offset of index table
    data_bytes.extend(struct.pack(">I", index_offset))

    with open(out_path, "wb") as f:
        f.write(data_bytes)

    print(f"Compiled {len(index_entries)} translations to {out_path} ({len(data_bytes)} bytes)")


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input.po> <output.lmo>")
        sys.exit(1)
    entries = parse_po_file(sys.argv[1])
    compile_to_lmo(entries, sys.argv[2])


if __name__ == "__main__":
    main()
