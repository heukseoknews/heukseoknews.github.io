"""새 정답 샘플 후보 뽑기. 같은 사건을 여러 매체가 쓴 비슷한 제목은 하나로 묶어서 한 건만 뽑는다.

  python collector/make_samples.py --n 100 [--seed 1] > candidates.json
기존 tests/classify_samples.json 에 있는 제목과 비슷한 기사는 제외한다. 라벨은 사람이 붙인다.
"""
import argparse, difflib, glob, json, random, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
norm = lambda t: ''.join(t.split()).casefold()
similar = lambda a, b: difflib.SequenceMatcher(None, a, b).ratio() > 0.75


def pick(articles, existing_titles, n, seed):
    old = [norm(t) for t in existing_titles]
    cand = [x for x in articles if len(norm(x['title'])) > 6 and not any(similar(norm(x['title']), o) for o in old)]
    random.Random(seed).shuffle(cand)
    picked: list[dict] = []
    for x in cand:  # 후보끼리도 비슷하면 건너뜀(같은 사건 중복 방지)
        if not any(similar(norm(x['title']), norm(p['title'])) for p in picked):
            picked.append(x)
        if len(picked) == n:
            break
    return picked


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--n', type=int, default=100); ap.add_argument('--seed', type=int, default=1)
    a = ap.parse_args()
    arts = [x for f in sorted(glob.glob(str(ROOT / 'data' / '????-??.json'))) for x in json.loads(Path(f).read_text(encoding='utf-8'))]
    old = [r['title'] for r in json.loads((ROOT / 'tests' / 'classify_samples.json').read_text(encoding='utf-8'))]
    json.dump([{'title': x['title'], 'feed_name': x['feed_name']} for x in pick(arts, old, a.n, a.seed)], sys.stdout, ensure_ascii=False, indent=1)
