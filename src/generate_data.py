"""Generate a realistic, Salesforce-style CRM export for the demo.

Creates reps, accounts and opportunities as CSVs in data/. A small share of
records carry the data-quality problems real CRMs have (missing amounts,
past close dates on open deals, stale deals, duplicates) so the pipeline's
quality checks have something to catch.
"""
import csv
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(42)
DATA = Path(__file__).resolve().parent.parent / "data"
TODAY = date(2026, 11, 16)  # a Monday, mid-quarter: the review runs for the week ending here

SEGMENTS = {"SMB": (4_000, 25_000), "Mid-Market": (20_000, 90_000), "Enterprise": (80_000, 400_000)}
TERRITORIES = ["West", "Central", "East", "Canada"]
STAGES = ["Prospecting", "Discovery", "Solution Fit", "Proposal", "Negotiation"]
SOURCES = ["Inbound", "Outbound", "Partner", "Event"]
FIRST = ["Ali", "Sara", "Omar", "Hina", "Bilal", "Zara", "Usman", "Maya", "Hamza", "Noor", "Daniel", "Grace"]
LAST = ["Khan", "Ahmed", "Malik", "Iqbal", "Shah", "Rehman", "Lopez", "Chen"]


def write(name, rows):
    with open(DATA / name, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    DATA.mkdir(exist_ok=True)

    reps = []
    for i in range(24):
        seg = list(SEGMENTS)[i % 3]
        quota = {"SMB": 180_000, "Mid-Market": 600_000, "Enterprise": 2_000_000}[seg]
        reps.append({"rep_id": f"R{i+1:03d}", "rep_name": f"{random.choice(FIRST)} {random.choice(LAST)}",
                     "segment": seg, "territory": TERRITORIES[i % 4], "quarterly_quota": quota})

    accounts = [{"account_id": f"A{i+1:04d}", "account_name": f"Fleet Co {i+1}",
                 "segment": random.choice(list(SEGMENTS)), "territory": random.choice(TERRITORIES)}
                for i in range(900)]

    opps = []
    for i in range(3200):
        rep = random.choice(reps)
        acct = random.choice([a for a in accounts if a["segment"] == rep["segment"]] or accounts)
        lo, hi = SEGMENTS[rep["segment"]]
        created = TODAY - timedelta(days=random.randint(1, 420))
        cycle = random.randint(20, 150)
        close = created + timedelta(days=cycle)
        reached = random.choices(range(5), weights=[30, 25, 18, 15, 12])[0]
        closed = close < TODAY and random.random() < 0.97
        won = closed and random.random() < (0.18 + 0.07 * reached)
        stage = ("Closed Won" if won else "Closed Lost") if closed else STAGES[reached]
        forecast = ("Closed" if won else "Omitted") if closed else \
            {4: "Commit", 3: "Best Case"}.get(reached, "Pipeline")
        last_activity = (close if closed else TODAY - timedelta(days=random.randint(0, min(21, (TODAY - created).days))))
        opps.append({
            "opportunity_id": f"O{i+1:05d}", "account_id": acct["account_id"], "owner_id": rep["rep_id"],
            "created_date": created.isoformat(), "close_date": close.isoformat(), "stage": stage,
            "max_stage_reached": STAGES[reached], "amount": round(random.uniform(lo, hi), -2),
            "forecast_category": forecast, "lead_source": random.choice(SOURCES),
            "last_activity_date": last_activity.isoformat(),
        })

    # Seed realistic data-quality problems.
    for o in random.sample(opps, 40):
        o["amount"] = ""
    for o in random.sample([o for o in opps if not o["stage"].startswith("Closed")], 35):
        o["close_date"] = (TODAY - timedelta(days=random.randint(5, 60))).isoformat()
    for o in random.sample([o for o in opps if not o["stage"].startswith("Closed")], 60):
        o["last_activity_date"] = (TODAY - timedelta(days=random.randint(45, 120))).isoformat()
    for o in random.sample(opps, 15):
        dup = dict(o)
        dup["opportunity_id"] = f"O{len(opps)+1:05d}"
        opps.append(dup)

    write("reps.csv", reps)
    write("accounts.csv", accounts)
    write("opportunities.csv", opps)
    print(f"Wrote {len(reps)} reps, {len(accounts)} accounts, {len(opps)} opportunities to {DATA}")


if __name__ == "__main__":
    main()
