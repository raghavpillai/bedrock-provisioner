"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { client } from "@/lib/orpc";

const RegionContext = createContext<{
  region: string;
  setRegion: (r: string) => void;
  enabledRegions: string[];
  invocationLoggingEnabled: boolean;
}>({
  region: "us-east-1",
  setRegion: () => {},
  enabledRegions: ["us-east-1"],
  invocationLoggingEnabled: false,
});

export function RegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegionState] = useState("us-east-1");
  const [enabledRegions, setEnabledRegions] = useState<string[]>(["us-east-1"]);
  const [invocationLoggingEnabled, setInvocationLoggingEnabled] = useState(false);

  useEffect(() => {
    client.settings.get({ region: "us-east-1" }).then((s) => {
      if (s.defaultRegion) setRegionState(s.defaultRegion);
      if (s.enabledRegions?.length) setEnabledRegions(s.enabledRegions);
      setInvocationLoggingEnabled(s.invocationLoggingEnabled);
    }).catch(() => {});
  }, []);

  function setRegion(r: string) {
    setRegionState(r);
    client.settings.setRegion({ region: r }).catch(() => {});
  }

  return (
    <RegionContext.Provider value={{ region, setRegion, enabledRegions, invocationLoggingEnabled }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  return useContext(RegionContext);
}
