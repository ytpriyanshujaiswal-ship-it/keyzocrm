# Keyzo CRM - Call Outcome Workflow Update

## Included in this update
- Clicking a lead's Call action records a call initiation event and clears the due/overdue next-activity slot immediately.
- A pending outcome marker is retained (`callOutcomePending`) so the lead is not silently treated as fully completed.
- A call outcome form captures Connected, Not Picked, Busy, Switched Off, Wrong Number, or Other.
- The form can update lead status, add a note, and schedule the next Call, Message/WhatsApp, Site Visit, Revisit, Meeting, or Other activity.
- The outcome and reminder are recorded in the lead history shared by the existing backend API.

## Verification
- `npm test`: 5 tests passed.
- Frontend production build was not verified because Vite dependencies were not installed in this environment (`vite: not found`); `npm install` timed out. Run `npm install` and `npm run build` in CI/deployment before release.
- This ZIP is an incremental update, not a claim that every phase of the wider CRM roadmap is complete or deployed.
