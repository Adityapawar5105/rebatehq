// Scroll to an on-page section heading once it exists. After a hash change the section may still be mounting,
// so this retries for up to three seconds. Used by the command palette and the Home work list (20 Nov 2026).
export function scrollToHeading(anchor: string, tries = 30) {
  const el = document.getElementById(anchor);
  if (el) el.scrollIntoView({ block: "start" });
  else if (tries) setTimeout(() => scrollToHeading(anchor, tries - 1), 100);
}
