"use client";
// Roadmap 9.5 (audit machines 13 and 20): one way for a panel to run a worker read and know whether it is loading,
// ready or failed, with a retry. Before this, each panel kept its own pair of state flags and some never left "loading"
// after a failure. Panels move to it only as they are touched.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/i18n";
import { initialQuery, nextQuery, type QueryState } from "./queryState";
export type { QueryState, QueryStatus } from "./queryState";

/** Runs `run` when `deps` change; an answer from an older run is ignored. `set` replaces the data after a write. */
export function useVaultQuery<T>(run: () => Promise<T>, deps: readonly unknown[], failure?: string) {
  const [state, setState] = useState<QueryState<T>>(initialQuery);
  const seq = useRef(0), runRef = useRef(run);
  runRef.current = run;
  const load = useCallback(() => {
    const id = ++seq.current;
    setState(s => nextQuery(s, { type: "start" }));
    runRef.current().then(data => { if (id === seq.current) setState(s => nextQuery(s, { type: "done", data })); },
      error => { if (id === seq.current) setState(s => nextQuery(s, { type: "fail", error: failure ?? errorText(error) })); });
  }, [failure]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => { seq.current++; }; }, deps);
  const set = useCallback((data: T) => { seq.current++; setState(s => nextQuery(s, { type: "set", data })); }, []);
  return { ...state, reload: load, set };
}
