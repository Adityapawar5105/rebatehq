// Roadmap 9.5: the loading / ready / failed machine behind useVaultQuery, free of React so the unit tests can import it.
export type QueryStatus = "loading" | "ready" | "failed";
export type QueryState<T> = { status: QueryStatus; data: T | null; error: string };
export type QueryEvent<T> = { type: "start" } | { type: "done"; data: T } | { type: "fail"; error: string } | { type: "set"; data: T };
/** A new run keeps the last data while it loads; a failure keeps it too, so a retry never blanks the panel. */
export function nextQuery<T>(state: QueryState<T>, event: QueryEvent<T>): QueryState<T> {
  switch (event.type) {
    case "start": return { status: "loading", data: state.data, error: "" };
    case "done": case "set": return { status: "ready", data: event.data, error: "" };
    case "fail": return { status: "failed", data: state.data, error: event.error };
  }
}
export const initialQuery = <T>(): QueryState<T> => ({ status: "loading", data: null, error: "" });
