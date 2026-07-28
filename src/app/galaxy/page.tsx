import { auth } from "@/auth";
import { GalaxyWorkspace } from "@/features/galaxy/galaxy-workspace";
import { getHomeData } from "@/server/services/home.service";
import { redirect } from "next/navigation";

export default async function GalaxyPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }
  const homeData = await getHomeData(userId);

  return (
    <GalaxyWorkspace
      initialArchivedPlanets={homeData.archivedPlanets}
      initialConfirmedMemories={homeData.confirmedMemories}
      initialGrowingBooks={homeData.growingBooks}
      initialLinks={homeData.relationships}
      initialPendingResonances={homeData.pendingResonances}
      initialPlanets={homeData.planets}
    />
  );
}
