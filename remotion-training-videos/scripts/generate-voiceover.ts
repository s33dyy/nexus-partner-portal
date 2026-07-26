import "dotenv/config";

import { mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type VoiceoverTrack = {
  slug: "super-admin-journey" | "partner-admin-journey" | "partner-user-journey" | "rewards-journey";
  script: string;
};

const OUTPUT_ROOT = resolve(process.cwd(), "public/audio");

const VOICEOVER_TRACKS: VoiceoverTrack[] = [
  {
    slug: "super-admin-journey",
    script: [
      "Start on the dashboard, where the super admin gets a single view of the entire portal: partner health, deal activity, reward flow, and the latest alerts.",
      "From there, move into partner approvals to review incoming applications, compare submitted and approved partners, and verify the attached documents before making a decision.",
      "Open a partner record to read the business details, inspect notes from the review team, and keep the status trail current as each account moves forward.",
      "Next, go to deal approvals. Smaller deals can move faster, while larger opportunities above the threshold require a closer look and an explicit admin decision.",
      "The same workspace also gives the super admin control over users and roles, the product catalog, rewards, news, and audit logs.",
      "That makes the admin journey a true operating center for the LIVEY portal."
    ].join(" "),
  },
  {
    slug: "partner-admin-journey",
    script: [
      "Begin the partner admin journey on the dashboard, where performance metrics and next-step prompts give the team a fast read on the business.",
      "Move into onboarding to confirm company details, document readiness, and the status of the account before the partner gets fully operational.",
      "The team view keeps responsibilities organized, so the partner admin can manage roles without losing the business context around the account.",
      "Deal registration is the next stop. The admin can review opportunities, update the pipeline, and keep every active deal moving through the sales process.",
      "Customers, documents, and analytics complete the picture by showing account health, uploaded files, and how the partner business is performing over time.",
      "This is the control room for the people who manage the partner motion every day."
    ].join(" "),
  },
  {
    slug: "partner-user-journey",
    script: [
      "The partner user journey focuses on execution.",
      "Dashboard metrics show where things stand right now, while deals and pipeline views help the user decide what to move forward today.",
      "Customers give context for the accounts being managed, documents keep the supporting files close at hand, and analytics shows what is moving and what needs attention.",
      "That makes it easy to jump between the daily workflow, the account view, and the evidence needed to support each opportunity.",
      "When the team is ready to recognize progress, the rewards page shows points, recent activity, and the catalog of items that can be requested.",
      "It is the practical everyday workspace for the people who keep the partnership moving."
    ].join(" "),
  },
  {
    slug: "rewards-journey",
    script: [
      "Rewards tie the whole workflow together.",
      "On the storefront, partner users can browse the catalog, check their point balance, and request a redemption in just a few clicks.",
      "That request lands in the super admin panel, where the pending items can be reviewed, approved, or rejected from one screen.",
      "The admin view keeps the catalog current and the redemption queue visible, so the process stays transparent from request to resolution.",
      "Every approval updates the point ledger, the redemption history, and the audit trail together.",
      "That keeps the rewards process simple to explain and easy to train."
    ].join(" "),
  },
];

function ensureParentDirectory(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed${result.status === null ? "" : ` with exit code ${result.status}`}`,
    );
  }
}

function generateVoiceoverTrack(track: VoiceoverTrack) {
  const aiffPath = resolve(OUTPUT_ROOT, `${track.slug}.aiff`);
  const mp3Path = resolve(OUTPUT_ROOT, `${track.slug}.mp3`);

  ensureParentDirectory(mp3Path);

  runCommand("say", [
    "-v",
    "Samantha",
    "-r",
    "168",
    "-o",
    aiffPath,
    track.script,
  ]);

  runCommand("ffmpeg", ["-y", "-i", aiffPath, "-codec:a", "libmp3lame", "-q:a", "2", mp3Path]);
  unlinkSync(aiffPath);
  console.log(`Generated ${track.slug}.mp3`);
}

async function generateVoiceover() {
  for (const track of VOICEOVER_TRACKS) {
    generateVoiceoverTrack(track);
  }
}

if (import.meta.main) {
  generateVoiceover()
    .then(() => {
      console.log("Training voiceover tracks generated");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
