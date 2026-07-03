import { auth } from "@/auth";
import { GalaxyWorkspace } from "@/features/galaxy/galaxy-workspace";
import { getHomeData } from "@/server/services/home.service";

export default async function GalaxyPage() {
  const session = await auth();
  const homeData = await getHomeData(session?.user?.id);

  return <GalaxyWorkspace initialPlanets={homeData.planets} />;
}
