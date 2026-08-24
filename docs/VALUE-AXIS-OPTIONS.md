# Value-Axis Options — Who tells the Arena what a strategy is worth?

**Status:** DECISION NEEDED (Kyami) · **Date:** 2026-08-24 · **Context:** honest round v4 verified
(`0xf170ef4c…b9bd7` on Sepolia); this is the last architectural question between us and mainnet.

## The hole being decided

Today the score that crowns the winner (`return_bps`, eligibility via `drawdown_bps`) is driven by
**strategy-reported `current_value`**. The contract enforces a lot around that number — first action
must equal `starting_units` exactly, `allocation ≤ maxAllocationBps` of reported value, drawdown cap,
and (since v4) escrowed action bonds pulled and verified by the Arena itself — but the *value axis
itself* is honor-system. A strategy that lies about its own P&L wins prizes it didn't earn. On
Sepolia with our own wallets that's fine. With real prize money it is the product's central trust
claim, and right now that claim is weak.

Why it's self-reported at all: Starknet contracts can't read *historical* wallet states, and a
strategy's wealth can sit anywhere (LP positions, other tokens, CEXs) — so the contract had no
reliable way to measure it. The three options below are three answers to that measurement problem.

---

## Option A — Bonded self-report (status quo + skin-in-the-game)

**Mechanism.** Keep everything as is. Add: registration requires a slashing bond (escrowed via the
existing `open_submit_action_escrowed` machinery — already built and verified). Anyone can submit a
fraud proof (e.g. "reported value contradicts your visible float"); a successful challenge burns the
bond. Reported values stay authoritative.

**What it enforces:** lying now has a price, paid upfront. Bond size caps the profitable lie.

**Remaining trust holes:** the big one stays — values are still self-reported; challenges require
someone to *notice* and *prove* a discrepancy (who watches? with what data?). Fraud-proof logic is
itself new attack surface. Effectively security-by-bounty instead of security-by-construction.

**Build & cost:** smallest. ~1 day (bond-on-register + challenge entrypoint + tests), one declare
(~40 STRK observed cost). No scorer changes.

**Product impact:** zero friction for strategies. But marketing "verifiable arena, trust us +
bonds" is the weakest claim among the three, and judges/users probing honesty will find the seam
fast — it's exactly the seam our own honest-round audit surfaced.

**Verdict:** acceptable as an interim demo hardening; wrong as the mainnet answer.

---

## Option B — Attested float (contract reads the value axis itself) ⭐ RECOMMENDED

**Mechanism.** Constrain each strategy's float to **one whitelisted token held in its own wallet**
(the exact shape our rehearsals already use: wallets normalized to exactly 1000 TestUSD, trading
through the whitelisted target whose proceeds return to the same token). Then:

- **At registration** the Arena calls `token.balance_of(registrant)` and stores it as
  `starting_value` — no more self-declared `starting_units`.
- **At close** it re-reads `balance_of` per candidate → `final_value`.
- Winner = best `(final − start)/start`; ties broken deterministically as today.
- **Intra-round drawdown** via a permissionless `checkpoint()` anyone can call: writes a timestamped
  balance snapshot; drawdown = peak-to-trough over stored checkpoints. (v1 honesty trade-off: if
  nobody calls `checkpoint()` mid-round, only start/end are observable — see limitations.)

Adapter-reported values stop feeding the scorer entirely — one value source, chain-read. The
confusing dual-path split we documented in v4 (escrowed actions don't drive `get_winner`) simply
dies. Escrowed action bonds stay exactly as built.

**What it enforces:** the score's numerator *and* denominator are measured by the contract from
chain state. A strategy cannot report a value the token contract disagrees with. This upgrades the
product claim from "strategies report honestly" to "the Arena measures the result itself."

**Remaining trust holes (honest list):**
1. Wealth outside the float token is invisible → strategies must be constrained to the float
   (enforceable: large mid-round inflows from outside would show up as balance jumps; treat
   unexplained jumps as forfeit, or require deposit-via-Arena only).
2. Intra-round drawdown observability depends on checkpoints being called (permissionless crank;
   strategist self-interest makes under-checkpointing possible — mitigate by requiring ≥N
   checkpoints before `settle()` eligibility).
3. Single-token floats exclude multi-position strategies (LPs, hedged books). That's a real product
   narrowing — it selects for "float manager" strategies, not "anything-goes funds."

**Build & cost:** moderate. `arena.cairo`: store float token at setup, replace reported-value reads
with `balance_of` calls (contract→token calls are plain CAJA calls, no oracle), add `checkpoint()`,
make `settle()` derive winner from stored attestations. Est. +10–14 Cairo tests, one new declare
(~40 STRK), honest-round/crosscheck scripts simplify (scoring inputs become chain-native). ~1–2 days
given codebase maturity.

**Product impact:** strongest claim achievable without custody: *self-measuring arena*. Demo story
is crisp — judges can watch the contract read balances itself. Matches what our two verified
honest rounds literally already did script-side; this moves that honesty INTO the contract.

**Verdict:** recommended. Best enforcement-per-line-of-code, no oracle dependency, no custody
honeypot, direct continuation of proven patterns.

---

## Option C — Custodial vault (Arena owns the money)

**Mechanism.** Strategies deposit into an Arena-owned vault and receive shares; all trading happens
through adapter calls that move **vault** funds; value = share accounting (deposits, adapter-reported
P&L on vault positions, redemptions). Nothing lives in strategy wallets, so nothing needs attesting.

**What it enforces:** total — custody, float, and P&L all live inside contracts. Multi-position
strategies become possible through standardized position types the vault understands.

**Remaining trust holes:** shifts rather than vanishes: the vault is now a big honeypot (audit
class: full DeFi vault), and position valuation for anything non-trivial still needs pricing
(oracle or AMM spot reads) — so C typically *includes* an oracle dependency for mark-to-market.
Adapter compromise = total loss. Much larger blast radius than B.

**Build & cost:** heavy. Vault contract + share accounting + adapter protocol spec + position-type
standard + migration of every script/test. Realistically 1–2 weeks minimum **plus** external
security review before it ever holds mainnet value — which we want anyway, but C raises the review
stakes from "important" to "blocking."

**Product impact:** the real endgame for a serious protocol (complex strategies, composability,
maybe third-party adapters). Overkill — and higher risk — as the *first* mainnet incarnation.

**Verdict:** right destination, wrong next step. B is a compatible stepping stone: the attestation
interfaces (checkpoint, measured settle) carry forward into C.

*(Note: a pure price-oracle axis — e.g. Pragma feeds marking positions to market — is not listed as
a fourth option because an oracle supplies prices, not holdings; it still needs a holdings model,
i.e. B or C underneath. It belongs inside C, or inside B later for non-float marks.)*

---

## Comparison

| | A Bonded self-report | B Attested float ⭐ | C Custodial vault |
|---|---|---|---|
| Score axis measured by | strategy | **contract (balance_of)** | contract (share accounting) |
| Lie viable? | yes, priced by bond | **no (for the float)** | no |
| New custody risk | none | none | **large honeypot** |
| Oracle dependency | none | none | usually yes |
| Strategy freedom | unlimited* | single-token float | multi-position (via standards) |
| Build | ~1 day | **~1–2 days** | 1–2 wks + blocking audit |
| Cost to reach Sepolia-verified | ~40 STRK | **~40 STRK** | ≫100 STRK |
| Mainnet claim strength | weak | **strong** | strongest (later) |
\* *unlimited freedom is also A's weakness — unverifiable claims*

## Recommendation

Ship **B**: it converts the honesty pattern we already proved twice in rehearsal into contract
enforcement, removes the one hole that matters for real prize money, costs ~one declare, keeps
everything else we built (bonds, permissionless lifecycle, crosscheck tooling) intact, and leaves a
clean migration path to C when the product outgrows single-token floats.

If approved, execution order: contract changes + tests → glibc scarb suite green → declare (~40
STRK, will request approval) → honest round v5 on the new class → extended crosscheck → docs.

**Decision requested:** proceed with B? Or prefer A as a fast interim and revisit B/C post-hackathon?
