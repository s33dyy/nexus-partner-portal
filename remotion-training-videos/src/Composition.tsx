import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  Composition,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const INTRO_FRAMES = Math.round(3 * FPS);
const OUTRO_FRAMES = Math.round(1 * FPS);
const VOICEOVER_FRAMES: Record<JourneyId, number> = {
  "super-admin-journey": Math.ceil(50.7 * FPS),
  "partner-admin-journey": Math.ceil(46.78 * FPS),
  "partner-user-journey": Math.ceil(39.73 * FPS),
  "rewards-journey": Math.ceil(34 * FPS),
};

type JourneyId =
  | "super-admin-journey"
  | "partner-admin-journey"
  | "partner-user-journey"
  | "rewards-journey";

type JourneyProps = {
  journeyId: JourneyId;
};

type JourneyScene = {
  image: string;
  eyebrow: string;
  title: string;
  detail: string;
  weight: number;
};

type JourneyDefinition = {
  id: JourneyId;
  badge: string;
  title: string;
  subtitle: string;
  closing: string;
  audio: string;
  accent: string;
  accentSoft: string;
  chips: string[];
  scenes: JourneyScene[];
};

const JOURNEYS: Record<JourneyId, JourneyDefinition> = {
  "super-admin-journey": {
    id: "super-admin-journey",
    badge: "Super admin",
    title: "Super admin journey",
    subtitle:
      "Approve partners, review deal thresholds, manage the catalog, and keep the whole portal under one control center.",
    closing: "Control, approvals, and audit all stay in one place.",
    audio: "audio/super-admin-journey.mp3",
    accent: "#f59e0b",
    accentSoft: "rgba(245, 158, 11, 0.18)",
    chips: ["Partner approvals", "Deal decisions", "Audit trail"],
    scenes: [
      {
        image: "captures/super-admin/dashboard.png",
        eyebrow: "Dashboard",
        title: "See the whole portal at a glance",
        detail:
          "Partner health, deal activity, reward flow, and the latest alerts are all visible from the first screen.",
        weight: 1,
      },
      {
        image: "captures/super-admin/partners-submitted.png",
        eyebrow: "Partner approvals",
        title: "Review the submitted queue",
        detail:
          "Compare new applications, inspect the attached documents, and decide which partners are ready to move forward.",
        weight: 1.2,
      },
      {
        image: "captures/super-admin/partners-approved.png",
        eyebrow: "Approved partners",
        title: "Open an approved partner record",
        detail:
          "Verify notes from the review team and keep the partner status trail current as the account progresses.",
        weight: 1.2,
      },
      {
        image: "captures/super-admin/deals.png",
        eyebrow: "Deal approvals",
        title: "Apply the threshold decision",
        detail:
          "Small deals can move quickly, while larger opportunities stay in review until the admin gives a clear approval.",
        weight: 1.15,
      },
      {
        image: "captures/super-admin/users.png",
        eyebrow: "Users and roles",
        title: "Keep access aligned",
        detail:
          "Manage users and roles from one place so the operating model stays consistent as the portal grows.",
        weight: 0.95,
      },
      {
        image: "captures/super-admin/catalog.png",
        eyebrow: "Catalog",
        title: "Maintain tiers and products",
        detail:
          "Keep the catalog current so the portal always reflects the latest partner offers and product rules.",
        weight: 0.95,
      },
      {
        image: "captures/super-admin/rewards.png",
        eyebrow: "Rewards",
        title: "Control the reward program",
        detail:
          "Monitor how reward settings and point flow behave across the portal before they reach the partner side.",
        weight: 0.95,
      },
      {
        image: "captures/super-admin/news.png",
        eyebrow: "News feed",
        title: "Publish updates and campaigns",
        detail:
          "Share launches, partner announcements, and other portal news without leaving the admin workspace.",
        weight: 0.85,
      },
      {
        image: "captures/super-admin/audit.png",
        eyebrow: "Audit logs",
        title: "Review the full action trail",
        detail:
          "Every important decision is captured here so the admin can trace what changed and who changed it.",
        weight: 0.9,
      },
    ],
  },
  "partner-admin-journey": {
    id: "partner-admin-journey",
    badge: "Partner admin",
    title: "Partner admin journey",
    subtitle:
      "Keep onboarding, team management, deals, documents, and reporting aligned for the partner account.",
    closing: "The partner admin keeps the account moving end to end.",
    audio: "audio/partner-admin-journey.mp3",
    accent: "#14b8a6",
    accentSoft: "rgba(20, 184, 166, 0.18)",
    chips: ["Onboarding", "Team control", "Pipeline management"],
    scenes: [
      {
        image: "captures/partner-admin/onboarding.png",
        eyebrow: "Onboarding",
        title: "Confirm the account is ready",
        detail:
          "Use onboarding to verify company details, documents, and the operational status before the partner goes live.",
        weight: 1.15,
      },
      {
        image: "captures/partner-admin/dashboard.png",
        eyebrow: "Dashboard",
        title: "Read the day at a glance",
        detail:
          "Performance metrics and next-step prompts help the admin prioritize work as soon as the portal opens.",
        weight: 1,
      },
      {
        image: "captures/partner-admin/team.png",
        eyebrow: "Team",
        title: "Keep roles organized",
        detail:
          "Assign responsibilities and keep the partner team structured around the business, not just the tools.",
        weight: 0.95,
      },
      {
        image: "captures/partner-admin/deals.png",
        eyebrow: "Deals",
        title: "Move opportunities through the pipeline",
        detail:
          "Review active deals, update progress, and keep the partner motion moving without losing context.",
        weight: 1.15,
      },
      {
        image: "captures/partner-admin/customers.png",
        eyebrow: "Customers",
        title: "Track account health",
        detail:
          "Use customer status and renewal signals to focus on the accounts that need attention first.",
        weight: 1,
      },
      {
        image: "captures/partner-admin/documents.png",
        eyebrow: "Documents",
        title: "Keep supporting files close",
        detail:
          "Documents stay attached to the workflow so compliance, approvals, and evidence are easy to find.",
        weight: 0.95,
      },
      {
        image: "captures/partner-admin/analytics.png",
        eyebrow: "Analytics",
        title: "See the business trend",
        detail:
          "The analytics view turns account activity into a simple story the partner admin can share with the team.",
        weight: 1.05,
      },
    ],
  },
  "partner-user-journey": {
    id: "partner-user-journey",
    badge: "Partner user",
    title: "Partner user journey",
    subtitle:
      "Execute daily work, move deals and accounts forward, and use rewards when the team is ready to recognize progress.",
    closing: "Execution stays clear, quick, and measurable.",
    audio: "audio/partner-user-journey.mp3",
    accent: "#38bdf8",
    accentSoft: "rgba(56, 189, 248, 0.18)",
    chips: ["Daily execution", "Account context", "Rewards access"],
    scenes: [
      {
        image: "captures/partner-user/dashboard.png",
        eyebrow: "Dashboard",
        title: "Start with the daily view",
        detail:
          "Use the dashboard to see live metrics, the current work queue, and the next best action for today.",
        weight: 1,
      },
      {
        image: "captures/partner-user/deals.png",
        eyebrow: "Deals",
        title: "Move opportunities forward",
        detail:
          "Deal records keep the user focused on the opportunities that need outreach, follow-up, or approval.",
        weight: 1.15,
      },
      {
        image: "captures/partner-user/pipeline.png",
        eyebrow: "Pipeline",
        title: "Watch what needs attention",
        detail:
          "Pipeline stages make it easy to spot blockers and see which opportunities are ready to move next.",
        weight: 1.15,
      },
      {
        image: "captures/partner-user/customers.png",
        eyebrow: "Customers",
        title: "Keep account context close",
        detail:
          "Customer data gives the partner user the account history and next-step clarity needed for daily execution.",
        weight: 0.95,
      },
      {
        image: "captures/partner-user/analytics.png",
        eyebrow: "Analytics",
        title: "Translate activity into progress",
        detail:
          "Simple charts and trends show what is moving well and where the team should lean in next.",
        weight: 1,
      },
      {
        image: "captures/partner-user/documents.png",
        eyebrow: "Documents",
        title: "Keep the supporting files handy",
        detail:
          "Files stay in reach when the user needs proof, compliance support, or a quick handoff to the next step.",
        weight: 0.95,
      },
      {
        image: "captures/partner-user/rewards.png",
        eyebrow: "Rewards",
        title: "Check points and request items",
        detail:
          "Points, recent activity, and the catalog of requestable items sit together in the same everyday workspace.",
        weight: 1.05,
      },
    ],
  },
  "rewards-journey": {
    id: "rewards-journey",
    badge: "Rewards",
    title: "Rewards journey",
    subtitle:
      "Show how partner users browse the catalog, submit a redemption, and let the super admin resolve the queue.",
    closing: "Requests and approvals stay transparent end to end.",
    audio: "audio/rewards-journey.mp3",
    accent: "#f97316",
    accentSoft: "rgba(249, 115, 22, 0.18)",
    chips: ["Catalog browsing", "Redemption requests", "Admin approvals"],
    scenes: [
      {
        image: "captures/rewards/catalog.png",
        eyebrow: "Catalog",
        title: "Browse what is available",
        detail:
          "Partner users can see reward options, point cost, and stock before they decide what to request.",
        weight: 1,
      },
      {
        image: "captures/rewards/redemption-request.png",
        eyebrow: "Request",
        title: "Submit a redemption",
        detail:
          "The request dialog keeps the process short: choose the item, confirm the details, and send it in.",
        weight: 1.25,
      },
      {
        image: "captures/rewards/admin-rewards.png",
        eyebrow: "Admin review",
        title: "Resolve the queue",
        detail:
          "Pending redemptions stay visible in the admin panel so the team can approve or reject from one place.",
        weight: 1.15,
      },
    ],
  },
};

function distributeFrames(totalFrames: number, weights: number[]) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const durations = weights.map((weight) => Math.max(1, Math.floor((totalFrames * weight) / totalWeight)));

  let remaining = totalFrames - durations.reduce((sum, value) => sum + value, 0);
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => (b.weight === a.weight ? a.index - b.index : b.weight - a.weight));

  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    durations[order[index % order.length].index] += 1;
  }

  return durations;
}

const calculateMetadata: CalculateMetadataFunction<JourneyProps> = ({ props }) => {
  const journey = JOURNEYS[props.journeyId];
  const audioFrames = measureAudioFrames(journey.audio);

  return {
    durationInFrames: Math.max(
      audioFrames + OUTRO_FRAMES,
      INTRO_FRAMES + OUTRO_FRAMES + journey.scenes.length * 42,
    ),
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
  };
};

function BackgroundOrbs({ accent, accentSoft }: { accent: string; accentSoft: string }) {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 180], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, #050a12 0%, #07111d 34%, #0a121d 68%, #05080f 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 12% 12%, ${accentSoft}, transparent 32%), radial-gradient(circle at 86% 6%, rgba(255,255,255,0.06), transparent 28%), radial-gradient(circle at 50% 100%, ${accentSoft}, transparent 22%)`,
          opacity: 0.95,
          translate: `${interpolate(frame, [0, 180], [0, 14], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}px ${interpolate(frame, [0, 180], [0, -8], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}px`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(135deg, ${accentSoft} 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.03) 100%)`,
          mixBlendMode: "screen",
          opacity: 0.75,
          scale: 1 + drift * 0.01,
        }}
      />
      <AbsoluteFill
        style={{
          boxShadow: "inset 0 0 180px rgba(0, 0, 0, 0.55)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "96px 96px",
          maskImage: "radial-gradient(circle at center, black 48%, transparent 100%)",
          opacity: 0.12,
        }}
      />
    </>
  );
}

function IntroScene({ journey }: { journey: JourneyDefinition }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const translateY = interpolate(frame, [0, 18], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill>
      <BackgroundOrbs accent={journey.accent} accentSoft={journey.accentSoft} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: 112,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          color: "#f8fafc",
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 18,
              padding: "16px 22px",
              borderRadius: 999,
              border: `1px solid ${journey.accentSoft}`,
              background: "rgba(5, 12, 24, 0.62)",
              boxShadow: "0 24px 80px rgba(0, 0, 0, 0.28)",
            }}
          >
            <Img
              src={staticFile("brand/livey-wordmark.png")}
              alt="LIVEY"
              style={{ height: 34, width: "auto" }}
            />
            <div
              style={{
                width: 1,
                alignSelf: "stretch",
                background: "rgba(255,255,255,0.18)",
              }}
            />
            <div
              style={{
                fontSize: 18,
                letterSpacing: "0.28em",
                textTransform: "uppercase",
                color: "rgba(248,250,252,0.72)",
              }}
            >
              Internal Training
            </div>
          </div>

          <div
            style={{
              padding: "12px 18px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              color: "rgba(248,250,252,0.72)",
              fontSize: 18,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Walkthrough video
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.2fr) minmax(380px, 0.8fr)",
            gap: 48,
            alignItems: "end",
          }}
        >
          <div
            style={{
              maxWidth: 1100,
              opacity,
              translate: `0px ${translateY}px`,
            }}
          >
            <div
              style={{
                marginBottom: 18,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: journey.accent,
              }}
            >
              {journey.badge}
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 112,
                lineHeight: 0.96,
                letterSpacing: "-0.05em",
                fontWeight: 800,
              }}
            >
              {journey.title}
            </h1>
            <p
              style={{
                marginTop: 28,
                maxWidth: 980,
                fontSize: 48,
                lineHeight: 1.2,
                color: "rgba(248,250,252,0.84)",
              }}
            >
              {journey.subtitle}
            </p>
          </div>

          <div
            style={{
              opacity,
              translate: `0px ${translateY + 8}px`,
              padding: 34,
              borderRadius: 34,
              border: `1px solid ${journey.accentSoft}`,
              background: "rgba(5, 12, 24, 0.7)",
              boxShadow: "0 32px 100px rgba(0, 0, 0, 0.36)",
            }}
          >
            <div
              style={{
                marginBottom: 18,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "rgba(248,250,252,0.65)",
              }}
            >
              What this video covers
            </div>
            <div style={{ display: "grid", gap: 16 }}>
              {journey.chips.map((chip) => (
                <div
                  key={chip}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "16px 18px",
                    borderRadius: 20,
                    background: "rgba(255,255,255,0.05)",
                    color: "#f8fafc",
                    fontSize: 28,
                    lineHeight: 1.2,
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      background: journey.accent,
                      boxShadow: `0 0 0 6px ${journey.accentSoft}`,
                      flexShrink: 0,
                    }}
                  />
                  <span>{chip}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function ScreenshotScene({
  journey,
  scene,
  index,
  total,
  durationInFrames,
}: {
  journey: JourneyDefinition;
  scene: JourneyScene;
  index: number;
  total: number;
  durationInFrames: number;
}) {
  const frame = useCurrentFrame();
  const captionOpacity = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const captionTranslate = interpolate(frame, [0, 16], [28, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const zoom = interpolate(frame, [0, durationInFrames], [1.05, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const slide = interpolate(frame, [0, durationInFrames], [14, -10], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Img
        src={staticFile(scene.image)}
        alt={scene.title}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          scale: zoom,
          translate: `0px ${slide}px`,
          filter: "saturate(1.04) contrast(1.02)",
        }}
      />

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(4, 8, 16, 0.14) 0%, rgba(4, 8, 16, 0.08) 44%, rgba(4, 8, 16, 0.72) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 16% 18%, ${journey.accentSoft}, transparent 26%), radial-gradient(circle at 84% 86%, rgba(255,255,255,0.06), transparent 24%)`,
          opacity: 0.72,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 112,
          right: 112,
          bottom: 96,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "end",
          gap: 32,
          color: "#f8fafc",
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            minWidth: 180,
            padding: "18px 22px",
            borderRadius: 20,
            border: `1px solid ${journey.accentSoft}`,
            background: "rgba(5, 12, 24, 0.7)",
            boxShadow: "0 28px 80px rgba(0, 0, 0, 0.28)",
            textAlign: "center",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: journey.accent,
          }}
        >
          {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </div>

        <div
          style={{
            flex: 1,
            maxWidth: 980,
            padding: 36,
            borderRadius: 34,
            border: `1px solid ${journey.accentSoft}`,
            background: "rgba(5, 12, 24, 0.74)",
            boxShadow: "0 32px 110px rgba(0, 0, 0, 0.34)",
            opacity: captionOpacity,
            translate: `0px ${captionTranslate}px`,
          }}
        >
          <div
            style={{
              marginBottom: 14,
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: journey.accent,
            }}
          >
            {journey.badge} · {scene.eyebrow}
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 70,
              lineHeight: 0.98,
              letterSpacing: "-0.05em",
              fontWeight: 800,
            }}
          >
            {scene.title}
          </h2>
          <p
            style={{
              marginTop: 18,
              marginBottom: 0,
              fontSize: 38,
              lineHeight: 1.22,
              color: "rgba(248,250,252,0.82)",
            }}
          >
            {scene.detail}
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function OutroScene({ journey }: { journey: JourneyDefinition }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const translateY = interpolate(frame, [0, 18], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill>
      <BackgroundOrbs accent={journey.accent} accentSoft={journey.accentSoft} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 112,
          color: "#f8fafc",
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1120,
            padding: 52,
            borderRadius: 40,
            border: `1px solid ${journey.accentSoft}`,
            background: "rgba(5, 12, 24, 0.72)",
            boxShadow: "0 36px 120px rgba(0, 0, 0, 0.4)",
            textAlign: "center",
            opacity,
            translate: `0px ${translateY}px`,
          }}
        >
          <Img
            src={staticFile("brand/livey-wordmark.png")}
            alt="LIVEY"
            style={{ height: 42, width: "auto", margin: "0 auto 22px" }}
          />
          <div
            style={{
              marginBottom: 16,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: journey.accent,
            }}
          >
            Training complete
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 84,
              lineHeight: 0.98,
              letterSpacing: "-0.05em",
              fontWeight: 800,
            }}
          >
            {journey.title}
          </h2>
          <p
            style={{
              margin: "22px auto 0",
              maxWidth: 900,
              fontSize: 40,
              lineHeight: 1.22,
              color: "rgba(248,250,252,0.82)",
            }}
          >
            {journey.closing}
          </p>

          <div
            style={{
              marginTop: 34,
              display: "flex",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            {journey.chips.map((chip) => (
              <div
                key={chip}
                style={{
                  padding: "14px 20px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.06)",
                  border: `1px solid ${journey.accentSoft}`,
                  color: "#f8fafc",
                  fontSize: 24,
                  fontWeight: 600,
                }}
              >
                {chip}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function JourneyVideo({ journeyId }: JourneyProps) {
  const journey = JOURNEYS[journeyId];
  const { durationInFrames } = useVideoConfig();
  const sceneWeights = journey.scenes.map((scene) => scene.weight);
  const sceneFrames = distributeFrames(durationInFrames - INTRO_FRAMES - OUTRO_FRAMES, sceneWeights);

  let cursor = INTRO_FRAMES;

  return (
    <AbsoluteFill>
      <Audio src={staticFile(journey.audio)} />
      <Sequence durationInFrames={INTRO_FRAMES}>
        <IntroScene journey={journey} />
      </Sequence>

      {journey.scenes.map((scene, index) => {
        const sceneDuration = sceneFrames[index];
        const from = cursor;
        cursor += sceneDuration;

        return (
          <Sequence key={scene.image} from={from} durationInFrames={sceneDuration}>
            <ScreenshotScene
              journey={journey}
              scene={scene}
              index={index}
              total={journey.scenes.length}
              durationInFrames={sceneDuration}
            />
          </Sequence>
        );
      })}

      <Sequence from={cursor} durationInFrames={OUTRO_FRAMES}>
        <OutroScene journey={journey} />
      </Sequence>
    </AbsoluteFill>
  );
}

const journeyOrder: JourneyId[] = [
  "super-admin-journey",
  "partner-admin-journey",
  "partner-user-journey",
  "rewards-journey",
];

const journeyCompositionIds: Record<JourneyId, string> = {
  "super-admin-journey": "SuperAdminJourney",
  "partner-admin-journey": "PartnerAdminJourney",
  "partner-user-journey": "PartnerUserJourney",
  "rewards-journey": "RewardsJourney",
};

const calculateJourneyMetadata: CalculateMetadataFunction<JourneyProps> = ({ props }) => {
  const journey = JOURNEYS[props.journeyId];
  const audioFrames = VOICEOVER_FRAMES[journey.id];

  return {
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    durationInFrames: Math.max(
      audioFrames + OUTRO_FRAMES,
      INTRO_FRAMES + OUTRO_FRAMES + journey.scenes.length * 42,
    ),
  };
};

export const MyComposition = () => {
  return (
    <>
      {journeyOrder.map((journeyId) => (
        <Composition
          key={journeyId}
          id={journeyCompositionIds[journeyId]}
          component={JourneyVideo}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          calculateMetadata={calculateJourneyMetadata}
          defaultProps={{ journeyId }}
        />
      ))}
    </>
  );
};
