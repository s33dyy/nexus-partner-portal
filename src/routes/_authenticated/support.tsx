import { createFileRoute } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/support")({
  component: SupportPage,
});

function SupportPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Support</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Support workflows can connect to live ticketing or Slack escalation once you’re ready.
      </CardContent>
    </Card>
  );
}
