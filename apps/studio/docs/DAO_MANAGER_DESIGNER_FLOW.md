# DAO manager, permission holder, and designer flow

## Purpose

This is the plain-language product flow Studio must implement. It is written
for a DAO manager paying a contractor, not for a contract developer.

Studio must never imply that creating a rule pays a contractor, that an expiry
triggers payment, or that a draft/share link is itself a private permission.

## The three roles

### 1. DAO manager / treasury issuer

The DAO manager connects the DAO treasury wallet. They create the payment
rule, approve any future deployment, and later use the issuer flow to send a
limited private permission pass.

The DAO manager does not give away the treasury key or general access to the
treasury.

### 2. Payment recipient / designer

The designer is the public wallet that receives STRK. Their wallet is fixed in
the payment rule. The designer can be the same person as the permission holder,
but these roles must be explained separately.

### 3. Permission holder / payment approver

The permission holder privately receives a limited capability pass. They can
request only the payment defined by the rule.

For a work-approval flow, this should normally be a DAO payments manager who
checks that the designer completed the work, then requests payment to the
designer. If the designer holds the pass, they can request payment themselves
within the rule's fixed limits; the contracts cannot verify that offchain work
was completed.

## Example: monthly social-media design work

The DAO wants up to four approved designs during one month.

| Rule | Value |
|---|---|
| Payment recipient | The designer's public Starknet wallet |
| Maximum per payment | 20 STRK per design |
| Total approved budget | 80 STRK for the month |
| Permission-pass supply | 1 pass for one payment approver |
| Behavior | Reusable: up to four 20-STRK requests while budget remains |
| Expiry | The final day of that month |

Expiry is a deadline. It does not move money, pay the designer, renew the
agreement, or make funds disappear. After expiry, the contracts reject another
request under that rule.

## The intended journey

### A. DAO manager creates a payment rule

1. Open Studio and connect the DAO treasury wallet.
2. Studio displays the connected treasury address; it must not ask the manager
   to type a different treasury address.
3. Choose STRK as the payment asset.
4. Enter the designer's public payment-recipient wallet.
5. Set the maximum per payment, total budget, pass supply, reusable/one-shot
   behavior, and expiry.
6. Review what will be public. The rule is still a draft until a verified
   deployment receipt exists.

### B. DAO manager creates and sends a private pass

This is a separate issuer flow after a valid mandate exists.

1. The DAO manager chooses the wallet that should hold the permission pass.
2. The issuer wallet approves exactly the required capability-token amount and
   public STRK20 pool-fee allowance.
3. The issuer's compatible wallet privately delivers one capability-token unit
   through STRK20.
4. The DAO manager sends the holder a normal out-of-band message and the
   public policy link.

The policy link is not a pass, password, or claim code. It identifies public
policy information only. The private pass is delivered to the holder wallet.

### C. Permission holder reviews and requests payment

1. The holder opens the policy link.
2. The holder connects the same compatible wallet that received the private
   pass.
3. The page shows the public rule: recipient, cap, remaining budget, expiry,
   and reusable/one-shot behavior.
4. The wallet privately discovers and proves the capability note when the
   holder requests the permitted payment.
5. The holder reviews the exact STRK payment and confirms it in their wallet.
6. The Gatekeeper and adapter enforce the fixed recipient, maximum payment,
   total budget, expiry, and behavior before any payment can proceed.

## What a private capability note is

A private capability note is a cryptographic wallet-held record that represents
one limited permission pass. It is not:

- a task brief, image, design file, invoice, or work-completion report;
- a middleman that decides when work is complete;
- a general treasury key;
- the public policy link itself.

The compatible wallet owns private note discovery and proof construction.
Studio must never request or store the note plaintext, viewing key, seed phrase,
or private key.

## Public versus private

Public on Starknet/explorers:

- DAO treasury, payment-recipient, policy, and contract addresses;
- asset, per-payment cap, total budget, expiry, and behavior;
- STRK20 deposit address, token, and amount when a pass is delivered;
- final payment/action and resulting public state.

Not made public by Studio:

- which compatible wallet holds the private capability note;
- note plaintext and proof material;
- seed phrases, private keys, and viewing keys.

Privacy does not erase every contextual clue. Timing, offchain messages, or
wallet/relay metadata can still reveal information about who acted.

## Studio UI requirements

- Lead with “Create a payment rule,” not unexplained “mandate” terminology.
- Require a connected DAO treasury wallet before the manager continues.
- Keep the connected treasury address non-editable.
- Explain payment recipient and permission holder as separate roles.
- Do not ask for a holder wallet during rule creation; it belongs to the later
  Issue Pass flow.
- Provide a shareable policy link only after a real policy exists. A local
  prototype link must be labelled **DRAFT — NOT ISSUED**.
- The holder screen must clearly distinguish a public policy link from a
  privately delivered pass.
- Do not show synthetic completion, fake balances, fake policies, or a
  deploy/payment button that cannot perform the represented action.
