import { useEffect, useState } from "react";

export function DesignDocApp(): JSX.Element {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return (
    <div data-testid="designdoc-root" data-ready={ready}>
      Design Doc
    </div>
  );
}

export default DesignDocApp;
