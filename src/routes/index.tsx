import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/local/client";

// Home: redirect based on the current auth session on the server or client.
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/dashboard" : "/auth" });
  },
  component: () => null,
});
