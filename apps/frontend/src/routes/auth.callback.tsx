import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/auth/callback")({
  component: GoogleAuthCallback,
});

function GoogleAuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // The backend has already established the HttpOnly session cookie.
    // Navigating into the authenticated tree lets AuthProvider validate it.
    void navigate({ to: "/dashboard", replace: true });
  }, [navigate]);

  return null;
}
