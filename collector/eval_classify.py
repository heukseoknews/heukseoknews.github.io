"""정답 샘플로 분류 정확도 측정.  python collector/eval_classify.py [--errors] [--split train|valid|all]"""
import argparse, collections, json, sys
from pathlib import Path
from classify import UNCATEGORIZED, classify

SAMPLES = Path(__file__).resolve().parent.parent / 'tests' / 'classify_samples.json'


def predict(r):
    """수집기와 같은 판정: 관련도 낮은 기사(relevant=False)는 미분류로 저장된다."""
    c = classify(r['title'], r['feed_name'])
    return c['category'] if c['relevant'] else UNCATEGORIZED


def evaluate(split='all'):
    rows = [r for r in json.loads(SAMPLES.read_text(encoding='utf-8')) if split in ('all', r['split'])]
    bad, ok = [], 0
    for r in rows:
        pred = predict(r)
        if pred == r['label']:
            ok += 1
        else:
            bad.append((r, pred))
    n = len(rows)
    cats = {}
    for c in sorted({r['label'] for r in rows}):
        tp = sum(1 for r in rows if r['label'] == c and predict(r) == c)
        pp = sum(1 for r in rows if predict(r) == c)
        ap = sum(1 for r in rows if r['label'] == c)
        cats[c] = {'precision': tp / pp if pp else None, 'recall': tp / ap if ap else None, 'support': ap}
    return {'per_category': cats, 'n': n, 'accuracy': ok / n, 'pred_uncat': sum(predict(r) == UNCATEGORIZED for r in rows) / n,
            'true_uncat': sum(r['label'] == UNCATEGORIZED for r in rows) / n, 'errors': bad}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--errors', action='store_true'); ap.add_argument('--split', default='all')
    a = ap.parse_args()
    for sp in ('train', 'valid', 'valid2', 'all'):
        r = evaluate(sp)
        print(f"{sp:5} n={r['n']:3} 정확도 {r['accuracy']:.1%}  예측 미분류 {r['pred_uncat']:.1%}  (정답 미분류 {r['true_uncat']:.1%})")
    pc = evaluate('all')['per_category'].get('자동차보험')
    if pc:
        print(f"자동차보험: 정밀도 {pc['precision']:.0%} 재현율 {pc['recall']:.0%} (정답 {pc['support']}건)")
    if a.errors:
        for r, pred in evaluate(a.split)['errors']:
            print(f"{'?' if r['ambiguous'] else ' '} [{r['split']}] 정답={r['label']} / 규칙={pred} | {r['title'][:60]}")
