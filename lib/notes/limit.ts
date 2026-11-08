// Shared by the page and the vault worker (7V-3b): the note limit is 1,000 Unicode code points.
export const NOTE_LIMIT = 1000;
/** Length in Unicode code points, the unit of the limit (an emoji counts once). */
export const noteLength = (text: string) => [...text].length;
