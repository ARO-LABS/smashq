import { useEffect, useState } from "react";
import { seedDesignDocState } from "./mockState";
import { useThemeEffect } from "../../hooks/useThemeEffect";
import { DesignDocShell } from "./DesignDocShell";

export function DesignDocApp(): JSX.Element {
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    seedDesignDocState();
    setSeeded(true);
  }, []);
  useThemeEffect();
  return (
    <div data-testid="designdoc-root" data-ready={seeded}>
      {seeded ? <DesignDocShell /> : null}
    </div>
  );
}

export default DesignDocApp;
