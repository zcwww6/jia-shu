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

  return <GalaxyWorkspace initialPlanets={homeData.planets} />;
}
