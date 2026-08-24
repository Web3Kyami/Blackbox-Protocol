# Product

## Thesis

Blackbox Arena is a constrained qualification environment for comparing multiple financial strategies under equal, precommitted rules. The public output is evidence of valid performance, not the underlying recipe.

## Primary user story

Amara, acting for a DAO or agent marketplace, creates a capped and time-bounded qualification Arena. Falcon, Tortoise, and Pulse register opaque strategy-version commitments, receive equal test balances, submit bounded actions, and are scored deterministically. Winning qualifies a strategy for a limited mandate; it does not grant unrestricted treasury control.

## MVP workflow

1. Sponsor creates and commits immutable rules.
2. Strategies register 32-byte opaque commitments before the start.
3. Every entrant starts with the same integer test balance.
4. Actions disclose only fields required for validation and scoring.
5. Deterministic checks accept or reject each receipt with a reason code.
6. Sponsor closes the Arena after its committed end.
7. Contract-equivalent scoring calculates return, maximum drawdown, eligibility, and tie-breakers.
8. Public UI presents rules, evidence, ranking, network labels, and privacy disclosure.
9. A capped settlement may follow only after the intended STRK20 path is verified.

## Smallest credible vertical slice

One Arena, one test asset, one mock execution target, three deterministic commitments, four action receipts, deterministic close and score, and a public result view. This deliberately excludes live trading, LLM scoring, tokenomics, databases, custody, and a generalized marketplace.

## Success measure

A judge understands in 30 seconds that equal rules were fixed in advance, invalid actions are rejected, the highest raw value need not win, and proprietary playbooks are not published.

