# Lighthouse eval scoreboard — 2026-09-19T20:23:45.017Z (n=30)

## Predictive quality (Lighthouse vs. base-rate baseline)
| outcome | n | AUROC | Brier | Brier (base) | ECE | ECE (base) | 90% CI coverage |
|---|---|---|---|---|---|---|---|
| completion | 30 | 0.668 | 0.201 | 0.208 | 0.186 | 0.113 | 0.933 |
| volunteer | 30 | 0.722 | 0.216 | 0.248 | 0.092 | 0.090 | 0.900 |
| cheerleader | 30 | 0.740 | 0.192 | 0.225 | 0.068 | 0.053 | 0.900 |
| donor | 30 | 0.503 | 0.209 | 0.212 | 0.206 | 0.127 | 0.733 |
| recruiter | 30 | 0.966 | 0.432 | 0.590 | 0.624 | 0.747 | 0.567 |

## Reasoning quality
- Evidence claims: 849; hallucinated source fields: 0 (rate 0.000, gate ≤ 0.01)
- Counter-evidence present: 1.000
- Consistency (std of completion estimate over 3 runs): 0.016 (gate ≤ 0.1)

## Fairness (synthetic groups the model never sees)
| outcome | parity diff (group) | equal-opp diff (group) | parity diff (wealth) |
|---|---|---|---|
| completion | 0.062 | 0.250 | 0.095 |
| volunteer | 0.171 | 0.500 | 0.096 |
| cheerleader | 0.085 | 0.667 | 0.044 |
| donor | 0.031 | 0.000 | 0.034 |
| recruiter | 0.079 | 0.064 | 0.074 |

## Ops
- released 27 / withheld 3 / partial 0 of 30
- cost: $1.78 total, $0.054 per report; tokens in/out per report 13581.200 / 4275.200

## Gates
- PASS hallucination
- PASS consistency
- FAIL parity
- FAIL ci_coverage

Full results: evals/results/2026-09-19T20-23-45-017Z.json