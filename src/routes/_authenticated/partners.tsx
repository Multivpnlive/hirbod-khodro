import { createFileRoute, Navigate } from "@tanstack/react-router";

// Keep old bookmarks working while financial profiles live under Customers.
export const Route = createFileRoute("/_authenticated/partners")({
  head: () => ({ meta: [{ title: "مشتریان | هیربد خودرو" }] }),
  component: () => <Navigate to="/customers" replace />,
});
