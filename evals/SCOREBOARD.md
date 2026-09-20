# Lighthouse eval scoreboard — 2026-09-20T06:51:11.063Z (n=30)

## Predictive quality (Lighthouse vs. base-rate baseline)
| outcome | n | AUROC | Brier | Brier (base) | ECE | ECE (base) | 90% CI coverage |
|---|---|---|---|---|---|---|---|
| completion | 30 | 0.696 | 0.198 | 0.208 | 0.180 | 0.113 | 0.933 |
| volunteer | 30 | 0.681 | 0.220 | 0.248 | 0.081 | 0.090 | 0.967 |
| cheerleader | 30 | 0.745 | 0.193 | 0.225 | 0.045 | 0.053 | 0.967 |
| donor | 30 | 0.489 | 0.210 | 0.212 | 0.114 | 0.127 | 0.733 |
| recruiter | 30 | 0.966 | 0.479 | 0.590 | 0.668 | 0.747 | 0.400 |

## Reasoning quality
- Evidence claims: 926; hallucinated source fields: 0 (rate 0.000, gate ≤ 0.01)
- Counter-evidence present: 1.000
- Consistency (std of completion estimate over 3 runs): 0.012 (gate ≤ 0.1)

## Fairness (synthetic groups the model never sees)
| outcome | parity diff (group) | equal-opp diff (group) | parity diff (wealth) |
|---|---|---|---|
| completion | 0.065 | 0.250 | 0.098 |
| volunteer | 0.174 | 0.500 | 0.072 |
| cheerleader | 0.097 | 0.333 | 0.028 |
| donor | 0.029 | 0.000 | 0.022 |
| recruiter | 0.122 | 0.000 | 0.057 |

## Ops
- released 26 / withheld 4 / partial 0 of 30
- cost: $1.84 total, $0.056 per report; tokens in/out per report 12906.867 / 4588.567

## Claim support (independent judge reads the cited field value)
- Judge: openai/gpt-5-4-mini. Claims judged: 950 — supported 609 (64.1%), partially 308, unsupported 33 (3.5%), field missing 0
- Unsupported rate by evidence grade: direct 2.3%, indirect 2.3%, absent 22.4%, anecdotal 1.4%
- PASS claim_support (unsupported ≤ 5%)

## Gates
- PASS claim_support
- PASS hallucination
- PASS consistency
- FAIL parity
- FAIL ci_coverage

Full results: evals/results/2026-09-20T06-51-11-063Z.json