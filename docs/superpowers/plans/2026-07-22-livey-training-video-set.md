# LIVEY Internal Training Video Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Remotion video project that produces four internal training MP4s for LIVEY: Super Admin Journey, Partner Admin Journey, Partner User Journey, and Rewards Journey.

**Architecture:** Create a standalone `remotion-training-videos/` project that reuses a shared Remotion rendering system, live portal screenshots, and data-driven scene manifests. Seed reproducible demo data in PostgreSQL first, capture the real portal states as PNG assets, then render the four compositions from a single shared scene pipeline so the video set stays consistent and easy to maintain.

**Tech Stack:** Remotion, React, TypeScript, Playwright, PostgreSQL, FFmpeg, the macOS `say` CLI, and the existing LIVEY TanStack Start app.

---

## File Structure

- `remotion-training-videos/package.json` owns the video project dependencies and scripts.
- `remotion-training-videos/src/Root.tsx` registers the four compositions and their shared render dimensions.
- `remotion-training-videos/src/data/videoManifest.ts` is the source of truth for scene timing, narration, captions, and asset paths.
- `remotion-training-videos/src/compositions/TrainingVideo.tsx` renders one video from the manifest data.
- `remotion-training-videos/src/components/SceneShell.tsx`, `remotion-training-videos/src/components/TitleCard.tsx`, `remotion-training-videos/src/components/CaptureFrame.tsx`, `remotion-training-videos/src/components/CaptionBar.tsx`, `remotion-training-videos/src/components/CalloutPill.tsx`, and `remotion-training-videos/src/components/RoleBadge.tsx` own the reusable frame, caption, badge, and callout primitives.
- `remotion-training-videos/public/brand/livey-wordmark.png`, `remotion-training-videos/public/brand/livey-favicon.png`, `remotion-training-videos/public/news/livey-wc350-qhd.png`, and the capture PNGs plus narration MP3s created in Task 3 store the static assets used by Remotion.
- `remotion-training-videos/scripts/capture-training-screens.ts` drives Playwright and exports live portal screenshots.
- `remotion-training-videos/scripts/generate-voiceover.ts` builds narration audio from the scene scripts.
- `remotion-training-videos/scripts/validate-manifest.ts` checks that every scene has matching assets and the runtime totals are correct.
- `scripts/training-video-fixtures.ts` defines the demo data set for the portal.
- `scripts/seed-training-video-data.ts` seeds the portal with the training dataset.
- `scripts/verify-training-video-data.ts` checks that the seeded data covers every route the videos need.

### Task 1: Scaffold the Remotion project and copy shared brand assets

**Files:**
- Create: `remotion-training-videos/package.json`
- Create: `remotion-training-videos/src/Root.tsx`
- Create: `remotion-training-videos/src/index.ts`
- Create: `remotion-training-videos/src/Composition.tsx`
- Create: `remotion-training-videos/public/brand/livey-wordmark.png`
- Create: `remotion-training-videos/public/brand/livey-favicon.png`
- Create: `remotion-training-videos/public/news/livey-wc350-qhd.png`

- [ ] **Step 1: Scaffold the project**

```bash
npx create-video@latest --yes --blank --no-tailwind remotion-training-videos
```

- [ ] **Step 2: Add the video-specific dependencies and shared brand assets**

```json
{
  "devDependencies": {
    "playwright": "^1.55.0"
  },
  "dependencies": {
    "@remotion/media": "^4.0.0"
  }
}
```

Copy the existing portal assets into the Remotion project public folder so `staticFile()` can reference them locally:

- `public/brand/livey-wordmark.png`
- `public/brand/livey-favicon.png`
- `public/news/livey-wc350-qhd.png`

- [ ] **Step 3: Verify the blank scaffold builds**

```bash
cd remotion-training-videos && npm run build
```

Expected: the scaffold compiles successfully before any custom compositions are added.

- [ ] **Step 4: Commit the scaffold**

```bash
git add -f remotion-training-videos
git commit -m "feat: scaffold remotion training project"
```

### Task 2: Seed reproducible training data for the portal

**Files:**
- Create: `scripts/training-video-fixtures.ts`
- Create: `scripts/seed-training-video-data.ts`
- Create: `scripts/verify-training-video-data.ts`

- [ ] **Step 1: Define the demo dataset and the verification assertions**

```ts
export const TRAINING_ACCOUNTS = {
  superAdmin: {
    email: "admin@livey.tech",
    password: process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD ?? "LIVEY-Admin-2026!",
  },
  partnerAdmin: {
    email: "northstar.admin@livey.tech",
    password: "Northstar-Admin-2026!",
  },
  partnerUser: {
    email: "northstar.user@livey.tech",
    password: "Northstar-User-2026!",
  },
} as const;
```

The fixture set needs at least:
- one partner in `submitted` state for partner review screens,
- one partner in `approved` state for partner admin and partner user screens,
- deals on both sides of the approval threshold,
- customer rows,
- portal team members,
- reward catalog items,
- one requested redemption,
- news feed rows,
- audit events,
- and at least one previewable partner document blob.

- [ ] **Step 2: Run the verification script and confirm it fails before seeding**

```bash
bun scripts/verify-training-video-data.ts
```

Expected: failure with missing-count assertions until the seed script runs.

- [ ] **Step 3: Implement the seed script with idempotent inserts**

```ts
await pool.query(
  `INSERT INTO profiles (id, email, password_hash, full_name, phone, company_name, partner_status, is_seed)
   VALUES ($1, $2, $3, $4, $5, $6, $7, true)
   ON CONFLICT (email) DO UPDATE SET
     password_hash = EXCLUDED.password_hash,
     full_name = EXCLUDED.full_name,
     phone = EXCLUDED.phone,
     company_name = EXCLUDED.company_name,
     partner_status = EXCLUDED.partner_status,
     is_seed = true`,
  [id, email, passwordHash, fullName, phone, companyName, partnerStatus],
);
```

Use the existing `uploadDocumentBlob()` helper from `src/server/livey-service.server.ts` to create a real previewable document blob:

```ts
await uploadDocumentBlob({
  bucket: "partner-documents",
  filePath: `${partnerId}/gst-certificate.pdf`,
  fileName: "GST Certificate.pdf",
  mimeType: "application/pdf",
  file: new File([Buffer.from("LIVEY training fixture")], "gst-certificate.pdf", {
    type: "application/pdf",
  }),
  isSeed: true,
});
```

- [ ] **Step 4: Seed the database and verify the counts**

```bash
bun scripts/seed-training-video-data.ts
bun scripts/verify-training-video-data.ts
```

Expected: the verification script reports all required training rows present.

- [ ] **Step 5: Commit the fixture work**

```bash
git add scripts/training-video-fixtures.ts scripts/seed-training-video-data.ts scripts/verify-training-video-data.ts
git commit -m "feat: seed training video fixtures"
```

### Task 3: Capture live portal screenshots and generate narration audio

**Files:**
- Create: `remotion-training-videos/scripts/capture-targets.ts`
- Create: `remotion-training-videos/scripts/capture-training-screens.ts`
- Create: `remotion-training-videos/scripts/generate-voiceover.ts`
- Create: `remotion-training-videos/public/captures/super-admin/dashboard.png`
- Create: `remotion-training-videos/public/captures/super-admin/partners-submitted.png`
- Create: `remotion-training-videos/public/captures/super-admin/partners-approved.png`
- Create: `remotion-training-videos/public/captures/super-admin/deals.png`
- Create: `remotion-training-videos/public/captures/super-admin/users.png`
- Create: `remotion-training-videos/public/captures/super-admin/catalog.png`
- Create: `remotion-training-videos/public/captures/super-admin/rewards.png`
- Create: `remotion-training-videos/public/captures/super-admin/news.png`
- Create: `remotion-training-videos/public/captures/super-admin/audit.png`
- Create: `remotion-training-videos/public/captures/partner-admin/onboarding.png`
- Create: `remotion-training-videos/public/captures/partner-admin/dashboard.png`
- Create: `remotion-training-videos/public/captures/partner-admin/team.png`
- Create: `remotion-training-videos/public/captures/partner-admin/deals.png`
- Create: `remotion-training-videos/public/captures/partner-admin/customers.png`
- Create: `remotion-training-videos/public/captures/partner-admin/documents.png`
- Create: `remotion-training-videos/public/captures/partner-admin/analytics.png`
- Create: `remotion-training-videos/public/captures/partner-user/dashboard.png`
- Create: `remotion-training-videos/public/captures/partner-user/deals.png`
- Create: `remotion-training-videos/public/captures/partner-user/pipeline.png`
- Create: `remotion-training-videos/public/captures/partner-user/customers.png`
- Create: `remotion-training-videos/public/captures/partner-user/analytics.png`
- Create: `remotion-training-videos/public/captures/partner-user/documents.png`
- Create: `remotion-training-videos/public/captures/partner-user/rewards.png`
- Create: `remotion-training-videos/public/captures/rewards/catalog.png`
- Create: `remotion-training-videos/public/captures/rewards/redemption-request.png`
- Create: `remotion-training-videos/public/captures/rewards/admin-rewards.png`
- Create: `remotion-training-videos/public/audio/super-admin-journey.mp3`
- Create: `remotion-training-videos/public/audio/partner-admin-journey.mp3`
- Create: `remotion-training-videos/public/audio/partner-user-journey.mp3`
- Create: `remotion-training-videos/public/audio/rewards-journey.mp3`

- [ ] **Step 1: Define the capture targets for each role and route**

```ts
export const CAPTURE_TARGETS = [
  { id: "super-admin-dashboard", role: "super_admin", path: "/dashboard", fileName: "super-admin/dashboard.png" },
  { id: "super-admin-partners", role: "super_admin", path: "/admin/partners", fileName: "super-admin/partner-approvals.png" },
  { id: "partner-admin-onboarding", role: "partner_admin", path: "/partner/onboarding", fileName: "partner-admin/onboarding.png" },
  { id: "partner-user-deals", role: "partner_user", path: "/deals", fileName: "partner-user/deals.png" },
  { id: "rewards-store", role: "partner_user", path: "/rewards", fileName: "rewards/store.png" },
] as const;
```

The actual target list must cover every scene in the four storyboards, including approved and submitted partner states, deal approval screens, customer and document screens, analytics, and admin rewards.

- [ ] **Step 2: Run the capture script once and confirm it fails before login helpers are wired**

```bash
cd remotion-training-videos && bun scripts/capture-training-screens.ts
```

Expected: failure until the script knows how to authenticate and export each state.

- [ ] **Step 3: Implement Playwright login helpers and screenshot exports**

```ts
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
await page.goto(`${baseUrl}/auth?mode=signin`);
await page.fill("#email", email);
await page.fill("#password", password);
await page.click('button[type="submit"]');
await page.screenshot({ path: outputPath, fullPage: false });
```

Save each PNG at the exact file path listed in Task 3's Files section so the Remotion project can reference it with `staticFile()`.

- [ ] **Step 4: Generate narration audio files**

Use the macOS `say` CLI to generate one narration track per composition, then convert the output to MP3 with FFmpeg:

```bash
say -v Samantha -o remotion-training-videos/public/audio/super-admin-journey.aiff --data-format=LEI16@22050 "Start on the dashboard..."
ffmpeg -y -i remotion-training-videos/public/audio/super-admin-journey.aiff remotion-training-videos/public/audio/super-admin-journey.mp3
```

Repeat for `partner-admin-journey`, `partner-user-journey`, and `rewards-journey`.

- [ ] **Step 5: Verify the files exist**

```bash
ls remotion-training-videos/public/captures
ls remotion-training-videos/public/audio
```

Expected: all route screenshots and all four narration tracks exist.

- [ ] **Step 6: Commit the asset pipeline**

```bash
git add remotion-training-videos/scripts/capture-targets.ts remotion-training-videos/scripts/capture-training-screens.ts remotion-training-videos/scripts/generate-voiceover.ts remotion-training-videos/public/captures remotion-training-videos/public/audio
git commit -m "feat: capture training assets"
```

### Task 4: Build the shared Remotion manifest and reusable scene primitives

**Files:**
- Create: `remotion-training-videos/src/data/videoManifest.ts`
- Create: `remotion-training-videos/src/lib/frameMath.ts`
- Create: `remotion-training-videos/src/components/SceneShell.tsx`
- Create: `remotion-training-videos/src/components/TitleCard.tsx`
- Create: `remotion-training-videos/src/components/CaptureFrame.tsx`
- Create: `remotion-training-videos/src/components/CaptionBar.tsx`
- Create: `remotion-training-videos/src/components/CalloutPill.tsx`
- Create: `remotion-training-videos/src/components/RoleBadge.tsx`

- [ ] **Step 1: Write the manifest types and one fully specified scene entry**

```ts
export type TrainingScene = {
  id: string;
  title: string;
  caption: string;
  narration: string;
  capture: string;
  audio: string;
  durationInFrames: number;
  callouts: string[];
};
```

The manifest must define the full scene list for:
- `super-admin-journey`
- `partner-admin-journey`
- `partner-user-journey`
- `rewards-journey`

- [ ] **Step 2: Run the manifest validation script and confirm it fails before all assets are wired**

```bash
cd remotion-training-videos && bun scripts/validate-manifest.ts
```

Expected: failure until every scene has a capture image, audio track, and duration.

- [ ] **Step 3: Implement the reusable composition primitives**

```tsx
export function SceneShell({ role, title, caption, capture, callouts, children }: Props) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#08111f" }}>
      <TitleCard role={role} title={title} />
      <CaptureFrame src={staticFile(capture)} />
      <CaptionBar text={caption} />
      <div className="callout-row">{callouts.map((item) => <CalloutPill key={item} text={item} />)}</div>
      {children}
    </AbsoluteFill>
  );
}
```

Keep the frame logic simple: one focal capture, one title region, one caption region, and a small callout row.

- [ ] **Step 4: Re-run the manifest validation and a TypeScript build**

```bash
cd remotion-training-videos && npm run build
bun scripts/validate-manifest.ts
```

Expected: both commands succeed once the manifest data and primitives line up.

- [ ] **Step 5: Commit the shared renderer**

```bash
git add remotion-training-videos/src/data/videoManifest.ts remotion-training-videos/src/lib/frameMath.ts remotion-training-videos/src/components
git commit -m "feat: add remotion training scene primitives"
```

### Task 5: Register the four compositions and wire the generic renderer

**Files:**
- Create: `remotion-training-videos/src/compositions/TrainingVideo.tsx`
- Create: `remotion-training-videos/src/compositions/SuperAdminJourney.tsx`
- Create: `remotion-training-videos/src/compositions/PartnerAdminJourney.tsx`
- Create: `remotion-training-videos/src/compositions/PartnerUserJourney.tsx`
- Create: `remotion-training-videos/src/compositions/RewardsJourney.tsx`
- Modify: `remotion-training-videos/src/Root.tsx`

- [ ] **Step 1: Register the compositions with the real runtimes and defaults**

```tsx
<Composition
  id="SuperAdminJourney"
  component={TrainingVideo}
  durationInFrames={450}
  fps={30}
  width={1920}
  height={1080}
  defaultProps={{ videoId: "super-admin-journey" }}
/>
```

Create the same pattern for `PartnerAdminJourney`, `PartnerUserJourney`, and `RewardsJourney` with their own durations and `videoId` values.

- [ ] **Step 2: Implement the generic renderer**

```tsx
export function TrainingVideo({ videoId }: { videoId: VideoId }) {
  const scenes = VIDEO_MANIFEST[videoId];

  return (
    <AbsoluteFill>
      {scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
          <SceneShell {...scene} />
          <Audio src={staticFile(scene.audio)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
```

- [ ] **Step 3: Render a representative still for each composition**

```bash
cd remotion-training-videos && npx remotion still SuperAdminJourney --frame=0 --scale=0.25
cd remotion-training-videos && npx remotion still PartnerAdminJourney --frame=0 --scale=0.25
cd remotion-training-videos && npx remotion still PartnerUserJourney --frame=0 --scale=0.25
cd remotion-training-videos && npx remotion still RewardsJourney --frame=0 --scale=0.25
```

Expected: each composition renders a readable opening frame without layout overflow.

- [ ] **Step 4: Commit the composition wiring**

```bash
git add remotion-training-videos/src/Root.tsx remotion-training-videos/src/compositions/TrainingVideo.tsx remotion-training-videos/src/compositions
git commit -m "feat: wire training video compositions"
```

### Task 6: Render the MP4s, inspect duration, and finish packaging

**Files:**
- Create: `remotion-training-videos/out/super-admin-journey.mp4`
- Create: `remotion-training-videos/out/partner-admin-journey.mp4`
- Create: `remotion-training-videos/out/partner-user-journey.mp4`
- Create: `remotion-training-videos/out/rewards-journey.mp4`

- [ ] **Step 1: Render the four final videos**

```bash
cd remotion-training-videos && npx remotion render SuperAdminJourney out/super-admin-journey.mp4
cd remotion-training-videos && npx remotion render PartnerAdminJourney out/partner-admin-journey.mp4
cd remotion-training-videos && npx remotion render PartnerUserJourney out/partner-user-journey.mp4
cd remotion-training-videos && npx remotion render RewardsJourney out/rewards-journey.mp4
```

- [ ] **Step 2: Confirm runtime and audio on every file**

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 remotion-training-videos/out/super-admin-journey.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 remotion-training-videos/out/partner-admin-journey.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 remotion-training-videos/out/partner-user-journey.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 remotion-training-videos/out/rewards-journey.mp4
```

Expected durations:
- Super Admin Journey: about 150 seconds
- Partner Admin Journey: about 150 seconds
- Partner User Journey: about 130 seconds
- Rewards Journey: about 120 seconds

- [ ] **Step 3: Make any final timing or caption tweaks and re-render only the affected composition**

If a scene feels too dense or the narration outpaces the visuals, adjust the manifest in `remotion-training-videos/src/data/videoManifest.ts`, then rerun the specific still and render commands for that composition only.

- [ ] **Step 4: Commit the finished video set**

```bash
git add remotion-training-videos/out/super-admin-journey.mp4 remotion-training-videos/out/partner-admin-journey.mp4 remotion-training-videos/out/partner-user-journey.mp4 remotion-training-videos/out/rewards-journey.mp4
git commit -m "feat: deliver livey training video set"
```

## Coverage Check

- Spec assumption about using the current implemented product only is covered by Tasks 2 through 6, which seed and capture live portal states rather than inventing new flows.
- The shared visual system is covered by Task 4 and Task 5, which centralize the frame shell, title cards, captions, and composition registration.
- The requirement for real portal UI and live screen states is covered by Task 2, Task 3, and Task 6, which seed data, capture screenshots, and render final MP4s from those screenshots.
- The separate rewards video is covered by Task 5 and Task 6 with its own composition and runtime budget.
- The acceptance criteria for four separate MP4s, readable captions, and correct runtimes are covered by Task 6.
