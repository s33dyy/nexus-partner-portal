# LIVEY Internal Training Video Set Design

**Goal:** Create a four-video internal training set that explains the LIVEY CRM from each role's point of view: Super Admin, Partner Admin, Partner User, and Rewards. Each video should feel like a practical walkthrough of the real product, not a marketing reel.

**Architecture:** Build one new Remotion project under `remotion-training-videos/` with a shared visual system and four compositions. The compositions should reuse the same brand styling, chapter card structure, callout treatment, and caption style so the set feels consistent. Each composition should render a separate MP4:
- `super-admin-journey.mp4`
- `partner-admin-journey.mp4`
- `partner-user-journey.mp4`
- `rewards-journey.mp4`

**Tech Stack:** Remotion, React, TypeScript, the existing LIVEY app UI, and the current brand palette and component language from the portal.

## Assumptions

- The videos are based on the current implemented product only.
- The visuals should use the real portal UI and live screen states, not invented dashboards or placeholder mockups.
- The primary format is `16:9` at `1920x1080`.
- The audio style is hybrid training narration with large on-screen callouts and captions.
- No music bed is required for v1. Voiceover and captions carry the training value.
- The reward video is separate from the three role journey videos, but it may briefly reference the approval loop to show how rewards are earned and redeemed.

## Product Coverage

The videos must only cover actions that exist in the app today.

- Super Admin can view the full dashboard, partner approvals, deal approvals, users and roles, tiers and products, news feed, rewards manager, and audit logs.
- Partner Admin can complete onboarding, review company profile status, manage team, create and move deals, inspect customers, manage documents, review analytics, and request rewards.
- Partner User can complete onboarding, use the dashboard, manage their own deals and pipeline items, maintain customers, preview documents, and request rewards.
- Rewards covers the shared points flow, tier progression, catalog browsing, redemption requests, and super admin approval or rejection.

## Visual System

- Use a clean enterprise training look that preserves the existing portal language.
- Keep one primary focal element per scene.
- Prefer full-screen UI captures with simple overlays over dense split-screen layouts.
- Use chapter cards with role labels and scene labels.
- Use callouts sparingly and keep them large enough to read from a distance.
- Use frame-based motion only. No CSS transitions or CSS animations.
- Keep text readable at video speed. Headline text should be very large, with supporting labels clearly separated.
- Use subtle zooms, fades, and slide-ins to direct attention.
- Captions should be rendered from the narration script and placed in a stable, high-contrast lower-third region.

## Composition Plan

All compositions should target 30 fps and stay within the runtime budgets below.

- `super-admin-journey`: about 450 frames, or 2:30
- `partner-admin-journey`: about 450 frames, or 2:30
- `partner-user-journey`: about 390 frames, or 2:10
- `rewards-journey`: about 360 frames, or 2:00

Each composition should follow the same repeating structure:
- title card
- short chapter intro
- UI scene with one action
- closing beat for the chapter
- final summary or transition

## Super Admin Journey

**Objective:** Show how the super admin owns approvals, shared configuration, and governance.

**Runtime:** About 2:30

1. 0:00-0:05 title card
   - Screen: brand title card
   - Purpose: Introduce the role and the topic.
   - Visual focus: `Super Admin Journey` title and role label.
   - Transition: Fade into the dashboard.

2. 0:05-0:18 dashboard control center
   - Screen: `Dashboard`
   - Purpose: Establish that the super admin sees the whole workspace.
   - Visual focus: Pipeline value, open deals, approved partners, customers, and reward points.
   - Transition: Slow zoom into the metric cards and feed.

3. 0:18-0:42 partner approvals
   - Screen: `Admin > Partner Approvals`
   - Purpose: Show how submitted partner applications are reviewed.
   - Visual focus: Selected partner record, uploaded documents, review notes, decision buttons.
   - Transition: Move from the queue into the detail panel, then highlight the decision action.

4. 0:42-1:06 deal approvals
   - Screen: `Admin > Deal Approvals`
   - Purpose: Show the strategic deal review process.
   - Visual focus: Approval queue, editable deal details, status controls.
   - Transition: Select a deal, inspect it, then show the decision state.

5. 1:06-1:28 users and roles
   - Screen: `Admin > Users & Roles`
   - Purpose: Show access management and role assignment.
   - Visual focus: Create user form, role selector, partner status fields.
   - Transition: Create or edit a user, then confirm the saved role state.

6. 1:28-1:50 tiers, products, and news
   - Screen: `Admin > Tiers & Products`, then `Admin > News Feed`
   - Purpose: Show how the super admin shapes the shared workspace.
   - Visual focus: Catalog items, tier definitions, news post editor.
   - Transition: Quick, controlled cuts between the two admin screens.

7. 1:50-2:18 rewards oversight
   - Screen: `Admin > Rewards`
   - Purpose: Show catalog maintenance and redemption handling.
   - Visual focus: Reward catalog list, selected item editor, redemption queue.
   - Transition: Move from catalog editing into redemption approval.

8. 2:18-2:30 audit trail close
   - Screen: `Admin > Audit Logs`
   - Purpose: End on governance and traceability.
   - Visual focus: Event stream and severity filters.
   - Transition: Slow scroll or subtle emphasis on the log entries.

## Partner Admin Journey

**Objective:** Show how a partner admin completes onboarding, manages the team, and runs day-to-day partner work.

**Runtime:** About 2:30

1. 0:00-0:05 title card
   - Screen: brand title card
   - Purpose: Introduce the role and the topic.
   - Visual focus: `Partner Admin Journey` title and role label.
   - Transition: Fade into onboarding.

2. 0:05-0:25 onboarding overview
   - Screen: `Partner Onboarding`
   - Purpose: Introduce the multi-step registration process.
   - Visual focus: Stepper, progress bar, step labels.
   - Transition: Stepper highlight moving through the onboarding stages.

3. 0:25-0:48 business profile entry
   - Screen: onboarding forms
   - Purpose: Show the business and company data that populates the partner record.
   - Visual focus: Company name, legal name, identifiers, address, country, state, business type, years in business, turnover band, employee count.
   - Transition: Type and select values in a controlled sequence.

4. 0:48-1:10 focus areas and documents
   - Screen: onboarding focus and documents steps
   - Purpose: Show the required business focus selection and document upload flow.
   - Visual focus: Focus chips, upload cards, uploaded file list.
   - Transition: Select multiple focus areas, then upload a supporting document.

5. 1:10-1:28 submit for review
   - Screen: onboarding review step
   - Purpose: Show the submission moment and the read-only post-submit state.
   - Visual focus: Review summary and submit action.
   - Transition: Submit and cut to the company profile with submitted status.

6. 1:28-1:48 company profile and team
   - Screen: `Partner > Company Profile`, then `Partner > Team`
   - Purpose: Show how the partner admin tracks status and manages teammates.
   - Visual focus: Partner status badge, review notes, team roster, invite form, role selector.
   - Transition: Status-first reveal, then roster and invite controls.

7. 1:48-2:10 deals and pipeline
   - Screen: `Deals` and `Pipeline`
   - Purpose: Show the operational workflow for opportunity management.
   - Visual focus: Deal creation form, deal detail panel, pipeline board, note dialog.
   - Transition: Create a deal, move it forward, add a note.

8. 2:10-2:30 customers, documents, analytics, and rewards
   - Screen: `Customers`, `Documents`, `Analytics`, `Rewards`
   - Purpose: Show the broader account-running workflow.
   - Visual focus: Customer table, document preview, analytics charts, rewards progress.
   - Transition: Short montage across each page.

## Partner User Journey

**Objective:** Show the partner user's daily execution flow, focused on their own records and the shared workspace.

**Runtime:** About 2:10

1. 0:00-0:05 title card
   - Screen: brand title card
   - Purpose: Introduce the role and the topic.
   - Visual focus: `Partner User Journey` title and role label.
   - Transition: Fade into the first state.

2. 0:05-0:20 entry state
   - Screen: onboarding or dashboard, depending on account status
   - Purpose: Explain the two possible starting points.
   - Visual focus: Pending or approved badge, sidebar, quick access areas.
   - Transition: Show the status difference before moving into the active workspace.

3. 0:20-0:42 onboarding completion
   - Screen: `Partner Onboarding`
   - Purpose: Show the user finishing the profile and document steps.
   - Visual focus: Profile fields, document uploads, submit action.
   - Transition: Keep the sequence concise and direct.

4. 0:42-1:05 dashboard
   - Screen: `Dashboard`
   - Purpose: Show the user's status and next steps.
   - Visual focus: Status badge, quick actions, updates feed, rewards progress.
   - Transition: Simple highlight sweep across the key dashboard areas.

5. 1:05-1:30 own deals and pipeline
   - Screen: `Deals` and `Pipeline`
   - Purpose: Show user-owned opportunities in motion.
   - Visual focus: Deal list, deal detail, stage board, notes.
   - Transition: Create or select a deal, then advance it one stage.

6. 1:30-1:52 customers and documents
   - Screen: `Customers` and `Documents`
   - Purpose: Show operational record keeping.
   - Visual focus: Customer rows, editable fields, document preview.
   - Transition: Edit a customer field, then preview a file.

7. 1:52-2:10 analytics and rewards
   - Screen: `Analytics` and `Rewards`
   - Purpose: Close with performance visibility and incentive progress.
   - Visual focus: Analytics charts, points total, tier card, catalog entries.
   - Transition: Move from trends into rewards standing.

## Rewards Journey

**Objective:** Explain how points are earned, how tier progression works, and how redemptions get approved.

**Runtime:** About 2:00

1. 0:00-0:05 title card
   - Screen: brand title card
   - Purpose: Introduce the topic.
   - Visual focus: `Rewards Journey` title and reward iconography.
   - Transition: Fade into the rewards dashboard.

2. 0:05-0:25 points origin
   - Screen: `Rewards`
   - Purpose: Show that deal wins create reward points automatically.
   - Visual focus: Recent activity list and positive point event.
   - Transition: Animate a point event into the total.

3. 0:25-0:50 tier progression
   - Screen: `Rewards`
   - Purpose: Show Bronze, Silver, Gold, and Platinum progression.
   - Visual focus: Standing card and progress bar.
   - Transition: Fill the progress bar and reveal the next tier threshold.

4. 0:50-1:20 catalog browsing
   - Screen: `Rewards`
   - Purpose: Show how users search and filter the storefront-style catalog.
   - Visual focus: Search field, category filter, reward cards.
   - Transition: Highlight one reward card and its cost.

5. 1:20-1:42 redemption request
   - Screen: reward request dialog
   - Purpose: Show the request form and submission flow.
   - Visual focus: Shipping name, shipping address, notes, submit button.
   - Transition: Fill the form, then submit the request.

6. 1:42-2:00 super admin review
   - Screen: `Admin > Rewards`
   - Purpose: Show the approval or rejection loop from the admin side.
   - Visual focus: Redemption queue, approve/reject buttons, request status.
   - Transition: Show approval first, then the alternate rejection state.

## Required Assets

- Live screen captures or rendered UI states for each relevant route.
- Authenticated states for super admin, partner admin, and partner user.
- A submitted partner record with documents and notes.
- A partner record in approved state.
- Several deals at different stages, including at least one above and one below the approval threshold.
- At least one customer record and one document preview.
- Reward catalog items and at least one requested redemption.
- Audit log entries and notifications generated from the sample flow.

## Narration Rules

- Keep narration calm, practical, and instructional.
- Use present tense and short sentences.
- State what the user is doing, what changes, and what the result means.
- Avoid marketing language and avoid describing future or unimplemented features.
- Keep the reward narration separate from the three role journeys so the same content is not repeated unnecessarily.

## Acceptance Criteria

- Four separate MP4 videos are produced.
- Each video stays within its runtime budget.
- Each video reflects only the actions that exist in the current app.
- The visual style matches the existing portal rather than feeling like a generic promo video.
- Captions or subtitles are present and readable.
- The rewards video is standalone and clearly explains both the user redemption flow and the super admin approval flow.

## Review Checklist

- No invented routes, buttons, or workflows.
- No scene overload or tiny text that would be hard to read during playback.
- No contradictory role permissions.
- No missing coverage for the major actions already implemented in the app.
- No placeholders or TODOs left in the spec.
