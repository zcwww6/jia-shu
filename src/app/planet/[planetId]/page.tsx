import { PlanetExplorer } from "@/features/planet/planet-explorer";

interface PlanetPageProps {
  params: Promise<{
    planetId: string;
  }>;
}

export default async function PlanetPage({ params }: PlanetPageProps) {
  const { planetId } = await params;
  return <PlanetExplorer planetId={planetId} />;
}
