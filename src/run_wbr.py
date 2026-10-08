"""Run the Weekly Business Review end to end.

1. Load the CRM export (data/*.csv) into SQLite.
2. Run every query in sql/wbr.sql (data-quality checks first, then the KPIs).
3. Write each result to output/*.csv and a readable output/wbr_report.md.
4. Ask a free open-source LLM (Hugging Face) for a short executive summary
   with recommendations. With no token, or if the call fails, fall back to a
   rule-based summary so the report still ships.

Usage:  python src/run_wbr.py [--today 2026-11-16]
"""
import argparse
import csv
import json
import os
import sqlite3
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA, OUT, SQL = ROOT / "data", ROOT / "output", ROOT / "sql" / "wbr.sql"
NUMERIC = {"amount", "quarterly_quota"}


def quarter_bounds(d: date):
    q = (d.month - 1) // 3
    start = date(d.year, 3 * q + 1, 1)
    end = date(d.year + (q == 3), (3 * q + 3) % 12 + 1, 1)
    return start.isoformat(), date.fromordinal(end.toordinal() - 1).isoformat()


def load(conn):
    for name in ("reps", "accounts", "opportunities"):
        with open(DATA / f"{name}.csv", newline="") as f:
            rows = list(csv.DictReader(f))
        cols = list(rows[0].keys())
        conn.execute(f"CREATE TABLE {name} ({', '.join(cols)})")
        conn.executemany(
            f"INSERT INTO {name} VALUES ({', '.join('?' * len(cols))})",
            [[(float(r[c]) if r[c] else None) if c in NUMERIC else r[c] for c in cols] for r in rows],
        )


def queries():
    blocks, name, buf = {}, None, []
    for line in SQL.read_text().splitlines():
        if line.startswith("-- name:"):
            if name:
                blocks[name] = "\n".join(buf)
            name, buf = line.split(":", 1)[1].strip(), []
        elif name:
            buf.append(line)
    blocks[name] = "\n".join(buf)
    return blocks


def run(today: str):
    q_start, q_end = quarter_bounds(date.fromisoformat(today))
    params = {"today": today, "q_start": q_start, "q_end": q_end}
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    load(conn)
    results = {}
    for name, sql in queries().items():
        if sql.lstrip().upper().startswith("CREATE"):
            conn.execute(sql)
            continue
        rows = [dict(r) for r in conn.execute(sql, params)]
        results[name] = rows
    return results, params


def to_markdown(rows, limit=None):
    rows = rows[:limit] if limit else rows
    if not rows:
        return "_No rows._"
    head = list(rows[0].keys())
    fmt = lambda v: f"{v:,.0f}" if isinstance(v, float) and abs(v) >= 1000 else ("" if v is None else str(v))
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    lines += ["| " + " | ".join(fmt(r[h]) for h in head) + " |" for r in rows]
    return "\n".join(lines)


def rule_based_summary(results):
    cov = results["coverage_forecast"]
    dq = results["data_quality"]
    low = [r for r in cov if (r["coverage_x"] or 0) < 3]
    lines = []
    for r in cov:
        lines.append(f"- {r['segment']}: {r['coverage_x']}x coverage on ${r['remaining_quota']:,.0f} remaining quota; "
                     f"commit forecast ${r['forecast_commit']:,.0f} vs quota ${r['quota']:,.0f}.")
    if low:
        lines.append(f"- Recommendation: build pipeline in {', '.join(r['segment'] for r in low)} "
                     "(below the 3x coverage rule of thumb) before pushing late-stage deals.")
    worst = max(dq, key=lambda r: r["records"])
    lines.append(f"- Data quality: fix '{worst['issue']}' first ({worst['records']} records). {worst['action']}.")
    return "\n".join(lines)


LLM_URL = os.environ.get("LLM_BASE_URL", "https://router.huggingface.co/v1").rstrip("/") + "/chat/completions"
LLM_MODEL = os.environ.get("LLM_MODEL", "meta-llama/Llama-3.1-8B-Instruct:fastest")


def llm_summary(results, params):
    """Ask an open-source LLM for a five-bullet executive summary. Returns (text, source).

    Defaults to Hugging Face Inference Providers (free tier, needs HF_TOKEN). Any
    OpenAI-compatible endpoint works through LLM_BASE_URL and LLM_MODEL, e.g. a local
    Ollama server (http://localhost:11434/v1) for a fully free, offline run.
    """
    token = os.environ.get("HF_TOKEN") or os.environ.get("LLM_API_KEY")
    local = "localhost" in LLM_URL or "127.0.0.1" in LLM_URL
    if not token and not local:
        return rule_based_summary(results), "rule-based (no HF_TOKEN set)"

    payload = {k: results[k] for k in ("coverage_forecast", "data_quality", "funnel", "pipeline_trend")}
    payload["bottom_5_reps"] = sorted(results["quota_attainment"], key=lambda r: r["attainment_pct"])[:5]
    prompt = (
        f"You are a revenue operations analyst preparing the weekly business review for sales leadership. "
        f"Review date {params['today']}; quarter runs {params['q_start']} to {params['q_end']}.\n\n"
        f"Data (JSON):\n{json.dumps(payload, default=str)}\n\n"
        "Write exactly five bullets for the VP of Sales: where the quarter will land and why, the biggest risk, "
        "which segment or reps need attention, which data-quality issue to fix first, and one concrete "
        "recommendation. Use the numbers. Plain language, no preamble."
    )
    body = json.dumps({"model": LLM_MODEL, "max_tokens": 800, "temperature": 0.2,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        with urllib.request.urlopen(urllib.request.Request(LLM_URL, body, headers), timeout=120) as r:
            reply = json.load(r)
        text = reply["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        return rule_based_summary(results), f"rule-based (LLM API error {e.code})"
    except (urllib.error.URLError, TimeoutError):
        return rule_based_summary(results), "rule-based (could not reach LLM API)"
    except (KeyError, IndexError, TypeError, ValueError):
        return rule_based_summary(results), "rule-based (unexpected LLM reply)"
    return (text, f"LLM ({LLM_MODEL})") if text else (rule_based_summary(results), "rule-based (empty reply)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default="2026-11-16")
    args = ap.parse_args()

    results, params = run(args.today)
    OUT.mkdir(exist_ok=True)
    for name, rows in results.items():
        if rows:
            with open(OUT / f"{name}.csv", "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                w.writeheader()
                w.writerows(rows)

    summary, source = llm_summary(results, params)
    report = f"""# Weekly Business Review: week ending {params['today']}

Quarter: {params['q_start']} to {params['q_end']}

## Executive summary
_Source: {source}_

{summary}

## Data quality (checked before any metric)
{to_markdown(results['data_quality'])}

## Coverage and forecast by segment
{to_markdown(results['coverage_forecast'])}

## Quota attainment, bottom 8 reps
{to_markdown(sorted(results['quota_attainment'], key=lambda r: r['attainment_pct'])[:8])}

## Funnel conversion, trailing 12 months
{to_markdown(results['funnel'])}

## Win rate by segment and lead source, trailing 12 months
{to_markdown(results['win_rate'])}

## New pipeline by week
{to_markdown(results['pipeline_trend'])}
"""
    (OUT / "wbr_report.md").write_text(report)
    print(f"Report written to {OUT / 'wbr_report.md'} ({source})")


if __name__ == "__main__":
    main()
