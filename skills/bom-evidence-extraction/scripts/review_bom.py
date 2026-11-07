#!/usr/bin/env python3
"""Flag candidate risks without changing data or claiming source verification."""
import argparse
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path


def review(candidate, profile='general'):
    issues = []
    rows = candidate.get('rows')
    if not isinstance(rows, list):
        return {'requiresSourceReview': True, 'issues': [{'code': 'INVALID_ROWS'}]}
    if candidate.get('bomPresent') is False and rows:
        issues.append({'code': 'ROWS_WITHOUT_BOM'})
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            issues.append({'row': i, 'code': 'INVALID_ROW'})
            continue
        qty = row.get('qty')
        if row.get('quantities') and qty not in (None, ''):
            issues.append({'row': i, 'code': 'UNSELECTED_VARIANT_QUANTITY'})
        if qty not in (None, ''):
            try:
                number = Decimal(str(qty))
                if not number.is_finite() or number < 0:
                    raise InvalidOperation
                pop = str(row.get('population') or '').replace(' ', '').lower()
                if number > 0 and pop in ('notfitted', 'dnp', 'dni', 'excluded'):
                    issues.append({'row': i, 'code': 'UNFITTED_WITH_POSITIVE_QUANTITY'})
            except (InvalidOperation, ValueError):
                issues.append({'row': i, 'code': 'NON_NUMERIC_ADOPTED_QUANTITY'})
        if not any(row.get(k) for k in ('part', 'mpn', 'name')):
            issues.append({'row': i, 'code': 'UNRESOLVED_IDENTITY'})
        if qty in (None, '') and not row.get('quantities'):
            issues.append({'row': i, 'code': 'UNRESOLVED_QUANTITY'})
    return {'requiresSourceReview': True, 'profile': profile, 'issues': issues}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--profile', choices=('general', 'mechanical', 'electronics', 'wire-list', 'drawing'), default='general')
    args = parser.parse_args()
    print(json.dumps(review(json.loads(args.input.read_text()), args.profile), ensure_ascii=False, indent=2))
