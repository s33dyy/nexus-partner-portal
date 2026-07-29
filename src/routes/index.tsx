import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/local/client";

// Home: render a lightweight client-side redirect so healthchecks get a 200 response.
export const Route = createFileRoute("/")({
  ssr: false,
  component: HomeRedirect,
});

function HomeRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      navigate({ to: data.session ? "/dashboard" : "/auth", replace: true });
    });

    return () => {
      active = false;
    };
  }, [navigate]);

  return null;
}
