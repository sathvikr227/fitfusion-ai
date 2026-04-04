# Claude.md — FitFusion AI

## Project summary

FitFusion AI is a fitness and nutrition web app built with **Next.js**, **Supabase**, and AI integrations. It helps users:

* Generate personalized workout plans
* Log meals and workouts
* Analyze food with AI
* Recognize food from images
* Track body metrics such as BMI and body fat
* View dashboard analytics
* Progress toward future goals like a **dream body** feature

The project is actively evolving. When making changes, preserve working flows and prefer small, safe edits over broad rewrites.

## Current tech stack

* **Frontend:** Next.js App Router, React, TypeScript
* **Styling:** Tailwind CSS
* **Backend/data:** Supabase
* **AI/services:** Cohere API and other AI helpers used across features
* **Deployment:** Vercel

## Important project rules

1. **Do not break existing working flows.** If a feature already works, patch it with the smallest possible change.
2. **Prefer App Router conventions.** Keep files aligned with the `src/app` structure.
3. **Keep code production-ready.** Handle loading, error, and empty states.
4. **Avoid hardcoding data** when an API or database source already exists.
5. **Use clear separation of concerns.** UI, data fetching, and helper logic should not be tangled together.
6. **Preserve the user experience.** Avoid regressions in navigation, page responsiveness, and saved data.
7. **Be careful with env vars.** Never print secrets into the UI or commit them into code.

## Existing feature areas

### Implemented / in progress

* Dashboard and analytics views
* Workout plan generation
* Body metric saving and display
* Meal logging and food analysis
* Image-based food recognition
* Workout help / exercise lookup area
* Supabase persistence for generated plans and metrics
* Generate flow using onboarding defaults

### Known direction for upcoming work

* Improve workout help quality and exercise matching
* Fix or refine GIF display for exercises
* Remove remaining hardcoded exercise datasets where possible
* Strengthen API-backed search and filtering
* Expand the “dream body” / goal planning feature
* Turn research-paper drawbacks into MVP features and roadmap items

## File and folder expectations

The project uses a structure similar to:

* `web/src/app/...` for routes and pages
* `web/src/app/api/...` for route handlers
* `web/src/components/...` for reusable UI pieces
* `web/src/lib/...` or similar for helpers, constants, and data access

When editing, keep new files consistent with this structure.

## Coding style guidelines

* Use **TypeScript** for app logic and data models
* Prefer **functional components** and React hooks
* Keep components focused and composable
* Use readable names for variables, props, and functions
* Avoid over-engineering; choose simple, maintainable implementations
* Use defensive checks for undefined, null, and API failures
* Keep UI clean and minimal, with good spacing and responsive layout

## API and data handling guidelines

* Validate inputs before sending requests to APIs
* Normalize API responses before rendering them
* Handle empty API responses gracefully
* If an API returns partial data, show what is available instead of failing silently
* Keep database writes idempotent where possible
* Do not assume external APIs always return the same fields

## Supabase guidelines

* Keep table access patterns consistent
* Preserve existing schemas unless a change is clearly needed
* When changing write flows, make sure reads still work for older records
* Prefer safe updates over destructive migrations unless explicitly requested

## UI behavior guidelines

* Every async screen should have loading and error states
* Empty states should explain what the user can do next
* Keep forms usable on mobile and desktop
* Avoid cluttering pages with too many sections
* Keep controls grouped logically

## Debugging workflow

When fixing a bug:

1. Identify the exact failing file and flow
2. Check whether the issue is in UI, API, data transformation, or storage
3. Make the smallest safe fix
4. Verify that related flows still work
5. If changing an API response shape, update all consuming components

## If asked to generate code

When asked to write code for this project:

* Return complete copy-paste-ready files when possible
* Mention any other files that must also change
* Keep changes consistent with the current folder structure
* Prefer direct fixes over vague suggestions

## Environment variables

Typical env vars may include:

* Supabase URL and anon/service keys
* AI provider API keys
* Any deployment-specific public config values

Never hardcode secrets in the source.

## Good assistant behavior for this repo

* Be practical and implementation-focused
* Use the current app structure rather than inventing a new one
* If something is ambiguous, make the safest reasonable assumption and state it briefly
* Keep answers aligned with the existing project direction

## Suggested working standard

When adding a feature, aim for:

* Working UI
* Clean data flow
* Reliable persistence
* Graceful error handling
* Minimal regression risk

## Notes for future changes

Treat paper drawbacks, missing features, and current limitations as a feature roadmap for FitFusion AI. When possible, transform a limitation into a concrete implementation target.
