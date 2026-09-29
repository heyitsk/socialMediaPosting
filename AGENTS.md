# Frontend Redesign Instructions

## Current Task

I am working on the `frontend-redesign` branch.

The current task is ONLY to redesign the existing frontend UI/UX.

Do NOT add new product features during this phase.

The goal is to make the existing application look and feel like a polished,
modern social-media-management SaaS application.

After the redesign is complete and stable, feature additions will be handled
as a separate phase.

---

## Technology

The frontend uses:

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Geist font
- TanStack React Query
- React Router
- Lucide React

Existing UI components are located in:

`frontend/src/components/ui/`

Reuse the existing component system.

Do NOT install another UI framework.

---

## Critical Rule: Preserve Existing Functionality

The existing frontend already communicates with a working backend.

The backend is being developed independently by another developer.

This task is UI/UX redesign only.

DO NOT:

- modify backend code
- modify backend APIs
- invent new API endpoints
- change API methods
- change API request/response structures
- change React Query keys
- change React Query behavior
- change OAuth flows
- change authentication behavior
- change existing state/data behavior
- replace polling with another architecture
- implement unfinished backend features
- implement new S3 functionality
- implement image cropping
- implement SSE/WebSockets
- add new social platforms

Preserve all existing functionality.

---

## Files That Must Not Be Modified

Do NOT modify these unless explicitly requested:

`backend/`

`workflows/`

`frontend/src/lib/api.ts`

`frontend/src/lib/api-schema.d.ts`

`frontend/src/App.tsx`

`frontend/src/main.tsx`

The API schema is generated and must not be manually edited.

---

## Primary Frontend Files

The main UI work should happen in:

`frontend/src/routes/layout.tsx`

`frontend/src/routes/dashboard.tsx`

`frontend/src/routes/composer.tsx`

`frontend/src/routes/history.tsx`

`frontend/src/routes/login.tsx`

and reusable components under:

`frontend/src/components/`

Global styling should only be changed when necessary.

---

## Existing Application Routes

Preserve the existing routes:

- `/`
- `/composer`
- `/history`
- `/login`

Do not rename or remove routes.

---

## Existing Dashboard Functionality

The Dashboard currently handles:

- backend health checking
- connected social accounts
- Facebook connection
- Instagram connection
- Threads connection
- LinkedIn connection
- YouTube connection
- OAuth redirect handling
- reconnecting accounts
- disconnecting accounts
- loading states
- error states
- toast notifications

Preserve all of this behavior.

The redesign should change presentation, layout, hierarchy,
components and styling without changing the underlying behavior.

---

## Existing Composer Functionality

The Composer contains existing logic for:

- connected account selection
- platform selection
- media type selection
- platform-specific media restrictions
- media URLs
- carousel handling
- YouTube options
- validation
- post creation
- loading states
- error handling
- toast notifications

Preserve all existing behavior.

Do not simplify the Composer by removing conditional logic.

Do not replace the existing media architecture with a new upload system.

Redesign the presentation only.

---

## Existing History Functionality

The History page currently retrieves posts from the existing API
and periodically refreshes the data.

Preserve:

- API calls
- polling behavior
- status handling
- post data
- error handling
- platform information
- failure information

Redesign only the presentation.

---

## Login

The current Login page is a placeholder.

During this redesign phase:

- improve its visual presentation if appropriate
- do NOT implement a new authentication system
- do NOT invent authentication APIs

---

## Design Direction

Use a modern social-media-management SaaS visual language.

The desired style is:

- professional
- clean
- modern
- polished
- slightly visual
- expressive but restrained
- strong visual hierarchy
- excellent spacing
- subtle borders
- clear cards
- clear status indicators
- platform-aware UI
- responsive
- accessible

Use the existing Geist font.

Use existing Tailwind/shadcn design tokens.

Use Lucide icons where appropriate.

Avoid:

- excessive gradients
- excessive animations
- excessive shadows
- giant decorative elements
- unnecessary glassmorphism
- overly colorful dashboards
- generic template-like layouts
- unnecessary dependencies

---

## Platform Identity

Social platforms should be visually distinguishable.

Use appropriate Lucide icons or existing icon support where possible.

Do not introduce large external icon packages just for social logos.

Platform identity should remain secondary to usability.

---

## Component Strategy

Prefer reusable components where they genuinely reduce duplication.

Examples may include:

- platform card
- connection status
- page header
- status badge
- empty state
- loading state
- account row
- sidebar navigation

Do not create dozens of tiny components unnecessarily.

Keep components understandable.

---

## Coding Rules

Before modifying a page:

1. Read the existing implementation.
2. Identify the existing data/API logic.
3. Identify the existing UI structure.
4. Preserve the data/API logic.
5. Modify only the presentation where possible.

Do not rewrite an entire page just for visual changes if the existing
logic can be preserved.

---

## Git Rules

Never switch branches automatically.

Never commit to `main`.

Never push to `main`.

Do not commit or push automatically.

Do not modify unrelated files.

Do not modify generated files unnecessarily.

---

## Validation

After meaningful changes:

Run from `frontend/`:

`npm run build`

Fix TypeScript and build errors.

Do not disable TypeScript checks to make the build pass.

Before considering a page complete:

- verify navigation
- verify existing buttons
- verify existing API calls remain intact
- verify loading states
- verify error states
- verify responsive layout
- verify no unrelated files changed

---

## Important Agent Behavior

When asked to redesign a page:

FIRST inspect the existing implementation.

Do NOT immediately edit files.

For the first planning step, provide:

1. current architecture
2. current functionality
3. proposed UI structure
4. files that would change
5. files that must remain untouched
6. potential risks

Wait for approval before implementation.

For implementation tasks, make small, reviewable changes.

After implementation, report:

- files changed
- functionality preserved
- build result
- any remaining issues