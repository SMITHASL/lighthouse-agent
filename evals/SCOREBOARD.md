# Lighthouse eval scoreboard — 2026-09-19T20:12:12.864Z (n=20)

## Predictive quality (Lighthouse vs. base-rate baseline)
| outcome | n | AUROC | Brier | Brier (base) | ECE | ECE (base) | 90% CI coverage |
|---|---|---|---|---|---|---|---|
| completion | 14 | 0.700 | 0.207 | 0.230 | 0.191 | 0.023 | 0.929 |
| volunteer | 14 | 0.677 | 0.213 | 0.313 | 0.104 | 0.261 | 0.929 |
| cheerleader | 14 | 0.500 | 0.204 | 0.204 | 0.321 | 0.006 | 0.929 |
| donor | 14 | 0.438 | 0.127 | 0.122 | 0.118 | 0.003 | 0.857 |
| recruiter | 14 | n/a | 0.400 | 0.608 | 0.616 | 0.780 | 0.786 |

## Reasoning quality
- Evidence claims: 414; hallucinated source fields: 0 (rate 0.000, gate ≤ 0.01)
- Counter-evidence present: 1.000
- Consistency (std of completion estimate over 2 runs): 0.010 (gate ≤ 0.1)

## Fairness (synthetic groups the model never sees)
| outcome | parity diff (group) | equal-opp diff (group) | parity diff (wealth) |
|---|---|---|---|
| completion | 0.142 | 0.500 | 0.211 |
| volunteer | 0.100 | 0.333 | 0.138 |
| cheerleader | 0.035 | 1.000 | 0.188 |
| donor | 0.030 | 0.000 | 0.119 |
| recruiter | 0.089 | 0.286 | 0.132 |

## Ops
- released 14 / withheld 8 / partial 6 of 20
- cost: $0.92 total, $0.040 per report; tokens in/out per report 10873.900 / 3133.100

## Gates
- PASS hallucination
- PASS consistency
- FAIL parity
- FAIL ci_coverage

Full results: evals/results/2026-09-19T20-12-12-864Z.json