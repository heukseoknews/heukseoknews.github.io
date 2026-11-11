"""이전 동등성 검증(수집기): 옛 코드(actuary-news-hub)와 새 구조(channels/insurance)가 같은 결과를 내는지 확인한다.

  python scripts/audit/equivalence_collector.py --old <옛 코드 사본 폴더> [--work <임시 폴더>]

옛 코드 사본은 `git -C <옛 저장소> archive <커밋> | tar -x -C <폴더>` 로 만든다(옛 저장소에는 쓰지 않음).
1) 저장 데이터 그대로 --reclassify  2) 분류 결과를 지운 데이터로 --reclassify(분류·점수·개체를 전부 다시 계산)
3) --reindex(index·trends)  4) 분류 정답 샘플 정확도(eval_classify) — 모두 옛 코드와 새 코드의 결과가 같아야 한다.
다르면 다른 기사·필드를 출력하고 종료 코드 1.
"""
from __future__ import annotations
import argparse, json, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DERIVED = ('category', 'sub_categories', 'tags', 'score', 'relevant', 'companies', 'orgs')


def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'실패: {" ".join(map(str, cmd))}\n{r.stdout}\n{r.stderr}')
    return r.stdout + r.stderr


def shards(d: Path) -> dict[str, list]:
    return {p.name: json.loads(p.read_text(encoding='utf-8')) for p in sorted(d.glob('????-??.json'))}


def compare(a: Path, b: Path, label: str, check_bytes: bool = True) -> list[str]:
    """월 파일별 기사 필드 비교. check_bytes=False 는 키 순서가 달라질 수 있는 비교(분류 필드를 지웠다 다시 붙인 사본)용."""
    errs, sa, sb = [], shards(a), shards(b)
    if sa.keys() != sb.keys():
        return [f'[{label}] 월 파일 목록이 다름: {sorted(sa)} vs {sorted(sb)}']
    n = 0
    for name in sa:
        if len(sa[name]) != len(sb[name]):
            errs.append(f'[{label}] {name} 건수 다름 {len(sa[name])} vs {len(sb[name])}'); continue
        for x, y in zip(sa[name], sb[name]):
            n += 1
            if x != y:
                diff = sorted(k for k in set(x) | set(y) if x.get(k) != y.get(k))
                errs.append(f'[{label}] {name} {x.get("id")} 필드 다름: {diff}')
        if check_bytes and (a / name).read_bytes() != (b / name).read_bytes():
            errs.append(f'[{label}] {name} 파일 바이트가 다름')
    print(f'[{label}] 기사 {n}건 비교, 차이 {len(errs)}건')
    return errs


def compare_port(old: Path, new: Path) -> list[str]:
    """이식 시점 데이터(옛 저장소) 대 지금 데이터: 옛 기사 id 는 모든 필드가 같아야 하고, 이후 수집으로 늘어난 기사는 건수만 보고한다."""
    rows = lambda d: {a['id']: a for p in sorted(d.glob('????-??.json')) for a in json.loads(p.read_text(encoding='utf-8'))}
    o, n = rows(old), rows(new)
    errs = [f'[이식 데이터] {i} 필드 다름: {sorted(k for k in set(o[i]) | set(n[i]) if o[i].get(k) != n[i].get(k))}' for i in o if i in n and o[i] != n[i]]
    errs += [f'[이식 데이터] {i} 가 지금 데이터에 없음' for i in o if i not in n]
    print(f'[이식 데이터] 이식 시점 {len(o)}건 비교, 차이 {len(errs)}건 · 이후 수집으로 추가 {len(set(n) - set(o))}건(지금 {len(n)}건)')
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--old', required=True, type=Path, help='옛 코드 사본(config/, collector/, data/ 가 있는 폴더)')
    ap.add_argument('--work', type=Path, default=None)
    ap.add_argument('--python', default=sys.executable)
    a = ap.parse_args()
    old = a.old.resolve()
    work = (a.work or Path(tempfile.mkdtemp(prefix='equiv-'))).resolve()
    shutil.rmtree(work, ignore_errors=True); work.mkdir(parents=True)
    src = ROOT / 'data' / 'insurance'
    errs: list[str] = []

    # 0) 이식한 데이터가 옛 데이터와 같은지
    errs += compare_port(old / 'data', src)

    # 1) 그대로 재분류
    for side in ('old', 'new'):
        shutil.copytree(src, work / f'{side}_asis')
    run([a.python, 'collector/collect.py', '--reclassify', '--data-dir', work / 'old_asis'], old)
    run([a.python, 'collector/collect.py', '--reclassify', '--channel', 'insurance', '--data-dir', work / 'new_asis'], ROOT)
    errs += compare(work / 'old_asis', work / 'new_asis', '재분류(그대로)')

    # 2) 분류 결과를 지운 사본으로 재분류: 모든 기사의 분류·점수·관련도·개체를 처음부터 다시 계산
    for side in ('old', 'new'):
        d = work / f'{side}_scrubbed'
        shutil.copytree(src, d)
        for p in d.glob('????-??.json'):
            rows = json.loads(p.read_text(encoding='utf-8'))
            for r in rows:
                r.update(category='?', sub_categories=[], tags=[], score=0, relevant=True)
                r.pop('companies', None); r.pop('orgs', None)
            p.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    out_old = run([a.python, 'collector/collect.py', '--reclassify', '--data-dir', work / 'old_scrubbed'], old)
    out_new = run([a.python, 'collector/collect.py', '--reclassify', '--channel', 'insurance', '--data-dir', work / 'new_scrubbed'], ROOT)
    errs += compare(work / 'old_scrubbed', work / 'new_scrubbed', '재분류(분류 지운 사본)')
    errs += compare(work / 'old_asis', work / 'new_scrubbed', '지운 사본 재계산 = 원본 재분류(내용)', check_bytes=False)  # 지웠다 붙인 companies·orgs 는 키 순서가 바뀐다
    if out_old.splitlines()[-9:] != out_new.splitlines()[-9:]:
        errs.append('[재분류 로그] 카테고리 분포 출력이 다름')

    # 3) index·trends 재생성
    for side, cwd, extra in (('old', old, []), ('new', ROOT, ['--channel', 'insurance'])):
        run([a.python, 'collector/collect.py', '--reindex', *extra, '--data-dir', work / f'{side}_asis'], cwd)
    ti = [json.loads((work / f'{s}_asis' / 'trends.json').read_text(encoding='utf-8')) for s in ('old', 'new')]
    for t in ti:
        t.pop('generated_at', None)
    if ti[0] != ti[1]:
        errs.append('[trends] 키워드 주별 집계가 다름')
    ix = [json.loads((work / f'{s}_asis' / 'index.json').read_text(encoding='utf-8')) for s in ('old', 'new')]
    if ix[0] != ix[1]:
        errs.append('[index] 월 목록·건수·크기가 다름')
    print(f'[index·trends] 월 {len(ix[1]["months"])}개, 키워드 {len(ti[1].get("keywords", []))}개 비교')

    # 4) 분류 정답 샘플 정확도
    ev = [run([a.python, 'eval_classify.py', '--errors'], d / 'collector') for d in (old, ROOT)]
    print('[정확도] 옛/새 eval_classify 출력:\n' + ev[1].strip())
    if ev[0] != ev[1]:
        errs.append('[정확도] eval_classify 출력(정확도·오답 목록)이 다름')

    for e in errs[:50]:
        print('  ✗', e)
    print('동등성(수집기):', '같음' if not errs else f'다름 {len(errs)}건')
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
