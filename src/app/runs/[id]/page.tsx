import { Workspace } from "@/components/workspace";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace runId={id} />;
}
