"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { client } from "@/lib/orpc";

const RegionContext = createContext<{
  region: string;
  setRegion: (r: string) => void;
}>({
  region: "us-east-1",
  setRegion: () => {},
});

export function RegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegionState] = useState("us-east-1");

  useEffect(() => {
    client.settings.get().then((s) => {
      if (s.defaultRegion) setRegionState(s.defaultRegion);
    }).catch(() => {});
  }, []);

  function setRegion(r: string) {
    setRegionState(r);
    // Persist to DB
    client.settings.setRegion({ region: r }).catch(() => {});
  }

  return (
    <RegionContext.Provider value={{ region, setRegion }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  return useContext(RegionContext);
}
