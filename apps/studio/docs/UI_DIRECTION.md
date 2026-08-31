# Studio UI direction

## Visual correction — Authority Ledger (2026-08-30)

The original “daylight treasury control room” established the correct product
separation from BlackBox’s dark editorial site, but its implementation drifted
into a generic light SaaS dashboard: white cards, blue buttons, rounded panels,
and a conventional sidebar. That execution is superseded.

The active direction is **Authority Ledger**:

> An institutional mandate document crossed with a permission operations
> terminal.

The system uses warm ledger paper, near-black operational navigation, signal
orange for consequential actions, violet for privacy, and acid chartreuse for
verified authority. Shapes are square and serialized rather than friendly
rounded cards. The core visual artifact is a clipped mandate instrument, not a
dashboard statistic card.

Distinctive product motifs:

- an animated “authority field” mapping Treasury → Private Pass → Operator;
- serialized mandate tickets and technical registry markings;
- oversized, condensed, uppercase outcome typography;
- grid-paper texture and instrument-like borders;
- ledger rows instead of floating card collections;
- sharp contrast between public rule surfaces and private-wallet signals;
- restrained rise, marquee, orbit, and hover-shift motion;
- no glassmorphism, neon crypto gradients, generic bento grids, or decorative
  3D blobs.

Research reviewed for this correction:

- Beautiful UI: approval cards, task rows, records tables, flowcharts, and
  selection actions;
- beUI: morphing panels, expandable actions, gliding tabs, number motion, and
  reduced-motion-aware primitives;
- Rare UI: the principle that a component should be rare and purposeful, not
  merely pre-styled;
- Transitions.dev: page-side transitions, panel reveal, status swaps, skeleton
  reveal, and error feedback;
- shadcn/ui: accessible composable primitives only—not its default dashboard
  appearance;
- UI Skills: layout variance, typographic intent, motion craft, and avoiding
  generic AI aesthetics.

Studio implements the interaction ideas in its existing vanilla render system;
it does not add React, Tailwind, Framer Motion, or copied third-party components.
CSS motion respects `prefers-reduced-motion`.

## Decision

BlackBox Studio will not reuse the existing BlackBox website's dark editorial
interface.

The existing product explains the privacy technology and proves the reference
flow. Studio is an operational workspace used repeatedly by treasury teams. It
needs to feel calmer, lighter, more structured, and more administrative.

The relationship should feel like two products from the same company—not two
copies of the same page.

## Design concept

**Daylight treasury control room**

Studio uses a light workspace with strong information hierarchy, restrained
color, plain financial language, and persistent transaction context.

Desired qualities:

- calm rather than mysterious;
- operational rather than promotional;
- trustworthy rather than futuristic;
- guided rather than technically dense;
- financially precise without resembling an exchange;
- distinctive without neon, glass, or generic crypto gradients.

## Research references

The following product families are pattern references, not designs to copy:

- [Safe](https://app.safe.global/) — treasury orientation, wallet context,
  transaction queues, and explicit action states.
- [Squads](https://app.squads.so/) — organization-first navigation and treasury
  operations.
- [OpenZeppelin Defender](https://defender.openzeppelin.com/) — security
  operations, transaction review, and administrative workflows.
- [Stripe Dashboard](https://dashboard.stripe.com/) — calm financial hierarchy,
  searchable activity, and progressive disclosure.
- [Linear](https://linear.app/) — compact navigation, fast command/search
  patterns, and consistent state language.

Patterns to adopt:

- persistent organization and network context;
- one dominant task per screen;
- review before execution;
- transaction timelines rather than raw logs;
- status expressed through label, color, and icon together;
- details available without overwhelming the primary flow;
- empty states that direct the next action.

Patterns to avoid:

- copying another product's layout or component styling;
- exchange-style market dashboards;
- oversized marketing typography inside the application;
- wallet addresses as the main visual identity;
- success states based only on a returned transaction hash;
- hiding risk or privacy boundaries inside tooltips.

## Relationship to the existing BlackBox interface

Retain:

- BlackBox name and geometric brand mark;
- precise, direct language;
- visible public/private boundary;
- strong contract-enforcement message;
- small use of the existing acid color as a family signature.

Change:

- light canvas instead of near-black pages;
- product sidebar instead of centered marketing navigation;
- sentence-case labels instead of extensive uppercase monospace;
- compact page titles instead of oversized editorial headlines;
- cobalt primary actions instead of acid-filled primary actions;
- cards, tables, timelines, and review rails designed for repeated use;
- minimal monospace reserved for addresses, hashes, amounts, and code.

The existing website explains **why BlackBox exists**. Studio helps a protocol
team **operate BlackBox**.

## Visual system

### Color

Proposed tokens:

| Purpose | Token | Value |
|---|---|---|
| Application canvas | `canvas` | `#F5F7FA` |
| Primary surface | `surface` | `#FFFFFF` |
| Raised surface | `surface-raised` | `#FBFCFE` |
| Primary text | `ink` | `#17202E` |
| Secondary text | `muted` | `#667085` |
| Border | `border` | `#DDE3EA` |
| Primary action | `cobalt` | `#3157D5` |
| Primary hover | `cobalt-dark` | `#2445B8` |
| Privacy signal | `violet` | `#6957D9` |
| Brand family signal | `acid` | `#B7E532` |
| Verified success | `green` | `#147D64` |
| Awaiting/attention | `amber` | `#A96813` |
| Failure/revocation | `red` | `#C2414B` |

Acid is a small brand signature used for the logo mark, selected privacy
indicators, and occasional emphasis. It is not the main button color.

Every status must include text or an icon; color alone is insufficient.

### Typography

- Product UI: a neutral, highly readable sans-serif such as Geist, Inter, or a
  system sans stack.
- Technical values: a restrained monospace such as Geist Mono or IBM Plex Mono.
- Body text: minimum `14px`; important explanations generally `15–16px`.
- Form controls and primary actions: minimum `14px`.
- Metadata: minimum `12px`, with adequate contrast.
- Page titles: generally `28–36px`, not marketing-scale display type.

Use sentence case. Uppercase is reserved for short technical or security tags.

### Shape and depth

- Corners: `10–14px` on panels and controls.
- Borders: visible neutral one-pixel boundaries.
- Shadows: subtle and used only for floating menus, dialogs, and the review rail.
- Avoid glass blur, luminous borders, large gradients, and decorative noise.

### Spacing

Use an eight-pixel base rhythm. Dense tables may use four-pixel internal steps,
but primary flows need generous separation between decisions.

## Application shell

### Desktop

```text
┌──────────────────────────────────────────────────────────────────────┐
│ BlackBox Studio       Search / command          Mainnet   0x12…89   │
├───────────────┬──────────────────────────────────────────────────────┤
│ Overview      │                                                      │
│ Mandates      │                 Page content                         │
│ Create        │                                                      │
│ Activity      │                                                      │
│ Help          │                                                      │
│               │                                                      │
│ Privacy model │                                                      │
└───────────────┴──────────────────────────────────────────────────────┘
```

- Sidebar width: approximately `232px`.
- Top utility bar shows search, network, and connected wallet.
- Content max width depends on task: dashboards may be wide; wizard content is
  deliberately narrower.
- The Create action is visually persistent in the sidebar.

### Mobile

- Compact top bar with Studio mark, network, and wallet.
- Bottom navigation: Overview, Mandates, Create, Activity.
- Wizard becomes one column.
- Primary continuation action is sticky at the bottom.
- Review summary becomes a collapsible sheet, not a tiny right rail.

## Screen patterns

### Studio home

Not a second large marketing landing page.

Structure:

1. Compact outcome-led introduction.
2. Primary `Create a mandate` action.
3. Short `How it works` sequence.
4. A realistic but clearly labelled product preview.
5. Public/private boundary.
6. Existing-organization wallet connection.

The first screen should feel like entering a product, not reading a campaign.

### Dashboard

```text
┌────────────────────────────────────────────────────────────────────┐
│ Treasury mandates                         + Create mandate          │
│ Control bounded payment authority across your protocol.            │
├────────────────┬────────────────┬────────────────┬─────────────────┤
│ Active  3      │ Budget left    │ Uses this month│ Expiring soon   │
├───────────────────────────────────────────┬────────────────────────┤
│ Mandates                                  │ Recent activity        │
│ Recipient  Asset  Cap  Status  Expiry     │ Timeline               │
│ …                                         │ …                      │
└───────────────────────────────────────────┴────────────────────────┘
```

Rules:

- Summary cards derive only from verified public state.
- Drafts are visibly separated from onchain mandates.
- Table rows use recipient labels when locally supplied, with address beneath.
- Status chips use plain language: Active, Draft, Confirming, Expired, Revoked.
- Empty dashboard replaces all metrics and tables with one honest creation path.

### Searchable mandate selector

Use a command-menu pattern:

- search field at top;
- mandate name, one-line purpose, and availability;
- Treasury Mandate selectable;
- future mandates disabled and labelled `Coming next`;
- keyboard and screen-reader navigation;
- no carousel.

### Configuration wizard

```text
┌───────────────┬──────────────────────────────┬──────────────────────┐
│ 1 Treasury    │ Step form                    │ Mandate summary      │
│ 2 Limits      │                              │ Recipient            │
│ 3 Behavior    │ Clear fields and help        │ Cap / budget         │
│ 4 Operator    │                              │ Expiry / mode        │
│ 5 Review      │ Back              Continue   │ Public / private     │
└───────────────┴──────────────────────────────┴──────────────────────┘
```

- Left stepper communicates progress.
- Center column contains the current decision only.
- Right review rail updates immediately and remains read-only.
- Validation appears after meaningful interaction, not before typing.
- Advanced contract values are collapsed below plain-language fields.
- Leaving the wizard offers Save draft, Discard, or Continue editing.

### Mandate review

The central visual object is a **Mandate Sheet**: a readable instrument that
summarizes authority like a contract cover page.

It includes:

- `Can do`: pay approved recipient;
- `Can use`: selected asset;
- `Maximum`: per-use cap;
- `Total authority`: budget;
- `Until`: expiry;
- `Behavior`: reusable or one-shot;
- `Cannot do`: change recipient, asset, or arbitrary calldata.

Beside it, show Public and Private Boundary panels. The user acknowledges the
boundary before deployment.

### Deployment progress

Use a vertical verified timeline:

```text
● Gatekeeper             Verified        Explorer ↗
● Treasury adapter       Confirming      0x91…2a
○ Capability token       Not started
○ Register mandate       Not started
○ Fund budget            Not started
```

Each row explains why the step exists. Technical calldata is available in a
details disclosure. Failure rows offer Retry, Review error, or Exit safely.

### Mandate detail

Header:

- mandate name or approved recipient;
- Active/Expired/Revoked status;
- Issue pass primary action;
- Share, Export, and Revoke secondary actions.

Body tabs:

- Overview
- Activity
- Contracts

Overview remains user-oriented. Contracts is explicitly technical.

### Activity and history

Use a timeline/table hybrid with:

- event name;
- confirmed timestamp;
- status;
- public amount when applicable;
- shortened transaction hash;
- explorer link;
- source label: Onchain or Local draft.

Do not display a private holder identity. If the issuer locally entered an
operator address, label it `Delivery recipient entered by issuer`, not `Public
holder`.

### Holder page

The holder link is simpler than the organization workspace. It uses the same
light visual system without the full sidebar.

The Mandate Sheet is the central object. The primary action is the exact
permitted operation—not generic `Execute` or `Exercise` language.

Examples:

- `Pay up to 0.01 STRK`
- `Confirm payment request`

Wallet and transaction states remain prominent and recoverable.

## Component inventory

- Studio shell and responsive navigation.
- Wallet/network control.
- Searchable mandate command menu.
- Stepper.
- Field, amount input, address input, token selector, date/expiry control.
- Mandate Sheet.
- Public/Private Boundary panel.
- Review rail.
- Status chip.
- Transaction timeline.
- Mandate table and empty state.
- Activity row.
- Confirmation dialog.
- Error/recovery panel.
- Toast only for noncritical acknowledgement; critical states remain inline.

## Content rules

Prefer:

- `Create mandate`
- `Issue pass`
- `Awaiting wallet confirmation`
- `Transaction submitted`
- `Verified onchain`
- `No pass available`
- `Pay up to 0.01 STRK`

Avoid:

- `Deploy magic`
- `Simulate`
- `Exercise capability` as the main user action
- `Transaction successful` before receipt verification
- `Anonymous payment`
- `Private deposit`
- unexplained `Gatekeeper`, `selector`, `felt`, or `calldata` in primary flow

## Accessibility requirements

- WCAG AA contrast for text and interactive controls.
- Visible keyboard focus.
- Full keyboard operation for template search and wizard.
- Labels remain visible; placeholders never replace labels.
- Errors connect to fields with accessible descriptions.
- Status never depends on color alone.
- Touch targets minimum `44px` where practical.
- Reduced-motion support.
- Tables convert to labelled cards on narrow screens.

## Motion

Motion communicates state rather than decoration:

- short step transitions;
- progress confirmation;
- timeline state changes;
- review-rail value updates;
- no looping glows, floating objects, or dramatic page reveals.

## Implementation guardrail

This document specifies direction, not authorization to implement. Future models
must complete the Phase 0 architecture gate before selecting UI dependencies or
writing Studio screens.
