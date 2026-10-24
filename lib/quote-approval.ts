import { HttpError } from "@/lib/authz";

export function assertNotQuoteCreator(userId: string, quoteCreatorId: string): void {
  if (userId === quoteCreatorId) throw new HttpError(403, "You cannot approve or deny a quote you created.");
}
