import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

/**
 * The component is loaded on demand.
 *
 * routeTree.gen.ts statically imports all 33 routes, so whatever a route file
 * pulls in ships on the very first page load — including the sign-in screen.
 * This page depends on recharts, which is ~450KB and by far the largest chunk
 * in the app, and it was being downloaded by every visitor whether or not they
 * ever opened Analytics.
 *
 * lazyRouteComponent keeps the route (and therefore its path, and the
 * generated tree) static while deferring the component and its dependency
 * graph until someone actually navigates here.
 */
export const Route = createFileRoute("/_authenticated/analytics")({
  component: lazyRouteComponent(() => import("@/components/analytics-page"), "AnalyticsPage"),
});
