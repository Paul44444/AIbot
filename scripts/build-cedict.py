"""Build browser dictionary shards: python3 scripts/build-cedict.py /path/to/cedict.txt.gz.
Source: CC-CEDICT / MDBG; derived dictionary data remains CC BY-SA 4.0.
"""
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys

raw = gzip.open(sys.argv[1], 'rt', encoding='utf-8').read()
version = hashlib.sha256(raw.encode()).hexdigest()[:12]
output = Path('public/dictionaries') / f'cedict-{version}'
output.mkdir(parents=True, exist_ok=True)
shards = [{} for _ in range(256)]
for line in raw.splitlines():
    match = re.match(r'^(\S+) (\S+) \[(.+?)\] /(.+)/$', line)
    if not match:
        continue
    traditional, simplified, pinyin, definitions = match.groups()
    entry = [pinyin, definitions.split('/')]
    for word in set([traditional, simplified]):
        entries = shards[ord(word[0]) % 256].setdefault(word, [])
        if entry not in entries:
            entries.append(entry)
for i, shard in enumerate(shards):
    (output / f'{i:02x}.json').write_text(json.dumps(shard, ensure_ascii=False, separators=(',', ':')) + '\n')
(output / 'NOTICE.txt').write_text('''CC-CEDICT — Community maintained Chinese-English dictionary, published by MDBG.
Source: https://www.mdbg.net/chinese/dictionary?page=cedict
License: Creative Commons Attribution-ShareAlike 4.0 International
https://creativecommons.org/licenses/by-sa/4.0/
Original CEDICT: Copyright (C) 1997, 1998 Paul Andrew Denisowski.
Changes: converted to JSON, indexed under simplified and traditional headwords,
duplicate entries removed and divided into 256 shards by first code point.
These derived dictionary files are distributed under the same CC BY-SA 4.0 license.
''' + '\n'.join(line for line in raw.splitlines() if line.startswith('#!')) + '\n')
print(output)
print(sum(len(shard) for shard in shards), 'headwords')
