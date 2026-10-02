import { createFileRoute, redirect } from "@tanstack/react-router";

// Old profile links keep working.
export const Route = createFileRoute("/agents/$agentId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/agent/$slug", params: { slug: params.agentId.replace(/^@/, "") } });
  },
});
