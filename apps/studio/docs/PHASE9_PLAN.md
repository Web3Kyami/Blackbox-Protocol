# Phase 9 — Integration and production

## Status: PLANNING ONLY — no Phase 9 source integration

Per `docs/IMPLEMENTATION_PLAN.md` Phase 9: integration into the existing build
or `/studio` route requires **explicit owner permission** because it crosses the
isolation boundary (`apps/studio/AGENTS.md` §Boundary + Phase 9 gate text:
"Integration ... requires explicit owner permission because it crosses the
isolation boundary").

This file records what Phase 9 scopes and what remains owner-gated. The prior
owner instruction to continue through Phase 9 authorized planning/documentation;
it did not authorize route integration or edits to `apps/web/`.

## Scope (verbatim from IMPLEMENTATION_PLAN.md)

> ## Phase 9 — Integration and production
> - Integration into the existing build or `/studio` route requires explicit
>   owner permission because it crosses the isolation boundary.
> - Verify production routes and assets.
> - Prepare the video flow with clear verified/unverified labels.
> Gate: existing BlackBox production routes remain unchanged and working.

## What is complete without crossing the boundary

1. **Boundary audit (read-only):** inspect `apps/web/` +
   `apps/landing/` routes + assets are byte-unchanged by Studio work. Evidence:
   `git -C /root/projects/BlackBox Arena status` shows Studio files under
   `apps/studio/` only; nothing in `apps/web/src/*.html` or `apps/landing/` was
   authored by the Studio phase work. This is not a production-route gate pass:
   the parent repo currently shows
   uncommitted changes in `apps/web/src/*` — see S035 anomaly; this must be
   confirmed not-Studio-originated before the Phase 9 gate closes.)
2. **Video-flow / demo labeling spec:** codify the verified/unverified labeling
   contract from `UI_DIRECTION.md` into a concrete reference table so the demo
   video (when recorded) labels every state honestly. No code; no boundary
   crossing.
3. **Planning artifacts:** this file and `docs/VIDEO_LABELING.md`. No `src/`
   or `/studio` route changes.

## What is RED (owner decision required before this agent)

1. **Mount `/studio` route into the existing BlackBox build.** This is the RED
   gate. Studio is currently a standalone local directory; integrating it into
   `apps/web/` or the root `build-web.mjs` pipeline crosses the isolation
   boundary. Owner must approve the exact mount before any code touches
   `apps/web/` or the root pipeline.
2. **Production asset promotion.** Any change to `apps/web/` assets for the
   demo is RED until (1) is approved.

## Phase 9 gate

> existing BlackBox production routes remain unchanged and working.

The agent can VERIFY this gate (read-only). The agent can NOT satisfy the
production integration piece without owner permission.

## Next action (concrete)

- Owner to approve or decline: "Mount Studio under `/studio` in the existing
  BlackBox build" (specify: path prefix `/studio`, mount point in
  `scripts/build-web.mjs`, route in `apps/web/`).
- Pending that decision, no Phase 9 implementation proceeds. The video-labeling
  spec and boundary audit are the only completed Phase 9 planning work.

## Source files
- `docs/UI_DIRECTION.md` (content rules + deployment timeline + source labels)
- `docs/IMPLEMENTATION_PLAN.md` (Phase 9 scope)
- `docs/STATUS.md`, `docs/HANDOFF.md`
