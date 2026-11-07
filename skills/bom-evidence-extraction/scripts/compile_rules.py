#!/usr/bin/env python3
"""Compile only source-independent Skill rules; never read benchmark artefacts."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILES = ('general', 'mechanical', 'electronics', 'wire-list', 'drawing')


def compile_rules(profile):
    if profile not in PROFILES:
        raise ValueError('Unknown source profile')
    files = ['references/core.md'] + ([] if profile == 'general' else ['references/' + profile + '.md'])
    content = '\n\n'.join((ROOT / name).read_text().strip() for name in files)
    return {'profile': profile, 'version': '1.1.0', 'loadedFiles': files,
            'sha256': hashlib.sha256(content.encode()).hexdigest(), 'rules': content}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=PROFILES, required=True)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    result = compile_rules(args.profile)
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else result['rules'])
