import { expect, test } from "bun:test";

import { supabase } from "@/integrations/local/client";
import { hasRealtimeSupport } from "@/routes/_authenticated/partner.agreement";

test("partner agreement page skips realtime when the client has no channel API", () => {
  expect(hasRealtimeSupport(supabase)).toBe(false);
});

test("partner agreement page detects realtime-capable clients", () => {
  const realtimeClient = {
    ...supabase,
    channel: () => ({
      on: () => ({
        subscribe: () => "subscription",
      }),
    }),
    removeChannel: async () => undefined,
  };

  expect(hasRealtimeSupport(realtimeClient as typeof supabase)).toBe(true);
});
