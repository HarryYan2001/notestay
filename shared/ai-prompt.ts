// The canonical implementation lives in `api/_ai-prompt.ts` so that the
// Vercel serverless function (`api/generate-note.ts`) can import it via a
// plain STATIC sibling path — the only shape Vercel's file tracer reliably
// bundles. See `api/_ai-prompt.ts` for the long-form rationale and the
// history of failures (FUNCTION_INVOCATION_FAILED on static cross-dir
// imports, "Cannot find module" on dynamic ones).
//
// This barrel keeps `shared/ai-prompt` working as the import path used by
// the client bundle (Vite), the Express dev server (`server/routes.ts`),
// and the offline smoke tests, so no other call sites need to change.
export * from "../api/_ai-prompt";
