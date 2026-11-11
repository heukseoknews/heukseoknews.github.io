"""정답 샘플로 분류 정확도 측정.  python collector/eval_classify.py [--channel insurance] [--samples 파일] [--errors] [--split train|valid|all]
따로 정밀도·재현율을 보여 줄 카테고리는 채널 categories.json 의 eval_focus."""
import argparse, collections, json, sys
from pathlib import Path
import channel
from classify import UNCATEGORIZED, classify

SAMPLES = Path(__file__).resolve().parent.parent / 'tests' / 'classify_samples.json'


def predict(r):
    """수집기와 같은 판정: 관련도 낮은 기사(relevant=False)는 미분류로 저장된다."""
    c = classify(r['title'], r['feed_name'])
    return c['category'] if c['relevant'] else UNCATEGORIZED


def evaluate(split='all', samples: Path = SAMPLES):
    rows = [r for r in json.loads(Path(samples).read_text(encoding='utf-8')) if split in ('all', r['split'])]
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
    d = n or 1  # 그 split 샘플이 없을 때(새 채널) 0으로 나누지 않게
    return {'per_category': cats, 'n': n, 'accuracy': ok / d, 'pred_uncat': sum(predict(r) == UNCATEGORIZED for r in rows) / d,
            'true_uncat': sum(r['label'] == UNCATEGORIZED for r in rows) / d, 'errors': bad}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--errors', action='store_true'); ap.add_argument('--split', default='all')
    ap.add_argument('--channel', default=channel.DEFAULT); ap.add_argument('--samples', type=Path, default=SAMPLES)
    a = ap.parse_args()
    cfg_dir = channel.use(a.channel)
    for sp in ('train', 'valid', 'valid2', 'all'):
        r = evaluate(sp, a.samples)
        if r['n']:
            print(f"{sp:5} n={r['n']:3} 정확도 {r['accuracy']:.1%}  예측 미분류 {r['pred_uncat']:.1%}  (정답 미분류 {r['true_uncat']:.1%})")
    focus = json.loads((cfg_dir / 'categories.json').read_text(encoding='utf-8')).get('eval_focus', [])
    for cat in focus:
        pc = evaluate('all', a.samples)['per_category'].get(cat)
        if pc:
            print(f"{cat}: 정밀도 {pc['precision']:.0%} 재현율 {pc['recall']:.0%} (정답 {pc['support']}건)")
    if a.errors:
        for r, pred in evaluate(a.split, a.samples)['errors']:
            print(f"{'?' if r['ambiguous'] else ' '} [{r['split']}] 정답={r['label']} / 규칙={pred} | {r['title'][:60]}")
