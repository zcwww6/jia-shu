import { bookDrafts, memoryStars, planets, resonanceTracks } from "@/shared/mock/galaxy-data";

export const demoSession = {
  currentUser: {
    id: "demo-user",
    name: "体验者",
    homePlanetId: "mock-me",
  },
  defaultPlanetId: "mock-mom",
  comparisonPlanetId: "mock-me",
  memoryTemplate: memoryStars[0],
  comparisonMemory: memoryStars[1],
  resonanceTemplate: resonanceTracks[0],
  bookTemplate: bookDrafts[0],
  availablePlanets: planets,
} as const;
