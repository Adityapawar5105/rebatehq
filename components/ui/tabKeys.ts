// Keyboard rule for every tab list (roadmap 8.1): Left goes back, Right goes forward (both wrap), Home and End
// jump to the ends. Kept free of React and CSS so the unit tests can import it.
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count < 1) return null;
  switch (key) {
    case "ArrowRight": return (index + 1) % count;
    case "ArrowLeft": return (index - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
