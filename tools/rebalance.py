"""Parse the JS bank literals in Code.gs, spread answer letters, re-emit.
Round-trips through JSON so the only change is the intended one."""
import re, json, sys

src = open('Code.gs').read()

FIELDS = ['section','topic','question','A','B','C','D','answer','explanation','image']

def scan_obj(s, i):
    """s[i] == '{'; return (dict, index_after)"""
    out = {}
    i += 1
    while True:
        m = re.match(r'\s*([A-Za-z]+)\s*:\s*', s[i:])
        if not m:
            raise SystemExit('bad key at %d: %r' % (i, s[i:i+40]))
        key = m.group(1); i += m.end()
        if s[i] == '"':
            buf = []; i += 1
            while True:
                ch = s[i]
                if ch == '\\':
                    nxt = s[i+1]
                    buf.append({'n':'\n','"':'"','\\':'\\'}.get(nxt, nxt)); i += 2
                elif ch == '"':
                    i += 1; break
                else:
                    buf.append(ch); i += 1
            val = ''.join(buf)
        else:
            m2 = re.match(r'[A-Za-z_][A-Za-z0-9_.]*', s[i:])
            val = '@@' + m2.group(0); i += m2.end()
        out[key] = val
        m3 = re.match(r'\s*,\s*', s[i:])
        if m3:
            i += m3.end(); continue
        m4 = re.match(r'\s*\}', s[i:])
        if m4:
            i += m4.end()
            m5 = re.match(r'\s*,?', s[i:])
            i += m5.end()
            return out, i
        raise SystemExit('bad terminator at %d' % i)

def parse_bank(name):
    tag = 'var %s = [' % name
    i = src.index(tag) + len(tag)
    items = []
    while True:
        m = re.match(r'\s*\{', src[i:])
        if not m:
            break
        i += m.end() - 1
        obj, i = scan_obj(src, i)
        items.append(obj)
    m_end = re.match(r'\s*\];', src[i:])
    assert m_end, 'no end for ' + name
    return items, i + m_end.end()

def jsq(v):
    if isinstance(v, str) and v.startswith('@@'):
        return v[2:]
    return '"' + str(v).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'

def emit(name, items):
    lines = ['var %s = [' % name]
    for o in items:
        lines.append('  {' + ', '.join('%s: %s' % (f, jsq(o[f])) for f in FIELDS) + '},')
    lines.append('];')
    return '\n'.join(lines)

LETTERS = ['A','B','C','D']

def rebalance(items, start_offset):
    counts = {}
    for n, o in enumerate(items):
        old = o['answer']
        if old not in LETTERS: o['answer'] = 'A'; old = 'A'
        target = LETTERS[(n + start_offset) % 4]
        # rotate option texts left by k so that old answer index maps onto target index
        k = (LETTERS.index(old) - LETTERS.index(target)) % 4
        if k:
            vals = [o[c] for c in LETTERS]
            vals = vals[k:] + vals[:k]
            for j, c in enumerate(LETTERS):
                o[c] = vals[j]
            o['answer'] = target
        counts[o['answer']] = counts.get(o['answer'], 0) + 1
    return items, counts

# --- round-trip safety: re-emit without changes must equal the original slice ---
report = []
for name, off in (('DEFAULT_BANK', 0), ('FALLBACK_BANK', 1)):
    items, end = parse_bank(name)
    start = src.index('var %s = [' % name)
    if emit(name, items) != src[start:end].rstrip('\n'):
        print('ROUND-TRIP MISMATCH for', name)
        print('--- emitted ---'); print(emit(name, items)[:1200])
        print('--- original ---'); print(src[start:end].rstrip('\n')[:1200]); sys.exit(1)
    report.append((name, len(items)))
    items, counts = rebalance(items, off)
    src = src[:start] + emit(name, items) + src[end:]
    print(name, 'letter spread:', counts)

# strip any stale letter references from explanations
src = re.sub(r'\s*\(Option [A-D]\.\)', '', src)
open('Code.gs','w').write(src)
print('banks:', report)
