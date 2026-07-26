# Graph Report - Livey Tech PAM CRM  (2026-07-23)

## Corpus Check
- 147 files · ~316,768 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1073 nodes · 2089 edges · 61 communities (57 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `92b63192`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 53|Community 53]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 73 edges
2. `useAuth()` - 47 edges
3. `Button` - 27 edges
4. `Card` - 24 edges
5. `CardContent` - 24 edges
6. `supabase` - 23 edges
7. `CardHeader` - 23 edges
8. `CardTitle` - 23 edges
9. `Badge()` - 23 edges
10. `CardDescription` - 20 edges

## Surprising Connections (you probably didn't know these)
- `seedDocumentBlob()` --calls--> `uploadDocumentBlob()`  [EXTRACTED]
  scripts/seed-training-video-data.ts → src/server/livey-service.server.ts
- `downloadCloudinaryDocumentBytes()` --calls--> `fetch()`  [INFERRED]
  src/server/livey-service.server.ts → src/server.ts
- `uploadToCloudinary()` --calls--> `fetch()`  [INFERRED]
  src/server/cloudinary.server.ts → src/server.ts
- `deleteFromCloudinary()` --calls--> `fetch()`  [INFERRED]
  src/server/cloudinary.server.ts → src/server.ts
- `AlertDialogHeader()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/alert-dialog.tsx → src/lib/utils.ts

## Communities (61 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (69): auth, AuthApi, AuthChangeEvent, authListeners, AuthStateChangeListener, completePasswordReset(), completeReset, createSignedUrl (+61 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (56): applyMigrations(), bootstrapDb(), RESET_TABLES, resetDatabase(), CAPTURE_ACCOUNTS, CAPTURE_TARGETS, CaptureAction, CaptureRole (+48 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (55): statusLabel, statusTone, admin, AppSidebar(), Item, partnerAdmin, shared, workspace (+47 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (51): Route, Route, Route, Route, Route, Route, Route, Route (+43 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (34): LookupComboboxProps, normalize(), toStaticOption(), DropdownOption, DropdownSourceConfig, DropdownSourceKey, CustomerRecord, createDropdownCustomer() (+26 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (36): code:bash (npx create-video@latest --yes --blank --no-tailwind remotion), code:bash (git add scripts/training-video-fixtures.ts scripts/seed-trai), code:ts (export const CAPTURE_TARGETS = [), code:bash (cd remotion-training-videos && bun scripts/capture-training-), code:ts (const browser = await chromium.launch({ headless: true });), code:bash (say -v Samantha -o remotion-training-videos/public/audio/sup), code:bash (ls remotion-training-videos/public/captures), code:bash (git add remotion-training-videos/scripts/capture-targets.ts ) (+28 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (34): Canonical Dropdown Source Registry Implementation Plan, code:sql (ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS customer_i), code:tsx (type LookupComboboxProps = {), code:tsx (const canCreate = source.kind !== "partner" && allowCreate &), code:ts (export function invalidateDropdownSource(source: keyof typeo), code:tsx (<LookupCombobox), code:tsx (<Input value={profile?.full_name ?? ""} readOnly />), code:ts (setDraft((current) => ({) (+26 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (21): AdminDealsPage(), AnalyticsPage(), SpotlightRow(), DealForm, DealsPage(), EMPTY_FORM, Route, formatDateLabel() (+13 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (20): AdminPartners(), Doc, Note, Partner, Route, STATUS_FILTERS, TIERS, AdminRewardsPage() (+12 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (23): AdminNewsPage(), DashboardMetric, NotificationFeedRow, PartnerSpotlight, Route, statusLabel, NewsFeedCard(), formatNewsRole() (+15 more)

### Community 10 - "Community 10"
Cohesion: 0.16
Nodes (16): EMPTY_FORM, NewsForm, NotificationRecord, EMPTY_FORM, PartnerTeamPage(), TeamForm, AccessDeniedPage(), AccessDeniedProps (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (28): code:ts (// tests/auth-flow.test.ts), code:ts (export const Route = createFileRoute("/_authenticated")({), code:bash (git add src/server/* src/routes/auth.tsx src/routes/reset-pa), code:ts (export interface PartnersRepo {), code:ts (export async function listPendingPartners(pool: Pool) {), code:bash (git add src/server/repos src/routes/_authenticated/dashboard), code:sql (update portal_demo_metrics set is_seed = true where id in (.), code:ts (await fetch("/api/demo/reset", { method: "POST" });) (+20 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (18): DocRow, NoteRow, Partner, PartnerPage(), Profile, Route, statusLabel, CustomerQuickCreateDialog() (+10 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (15): AccordionContent, AccordionItem, AccordionTrigger, Checkbox, HoverCardContent, InputOTP, InputOTPGroup, InputOTPSeparator (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (17): AdminAuditPage(), AdminCatalogPage(), CatalogForm, EMPTY_FORM, DashboardPage(), DocRow, DocumentsPage(), Partner (+9 more)

### Community 15 - "Community 15"
Cohesion: 0.1
Nodes (14): distributeFrames(), INTRO_FRAMES, journeyCompositionIds, JourneyDefinition, JourneyId, journeyOrder, JourneyProps, JOURNEYS (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.16
Nodes (17): Field(), cn(), ButtonProps, buttonVariants, Calendar(), CalendarDayButton(), Pagination(), PaginationContent (+9 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (13): businessSchema, companySchema, descriptionFor(), DocRow, FOCUS_AREAS, Form, OnboardingPage(), REQUIRED_DOC_TYPES (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (18): Account dropdown flow, Account selection, Canonical Dropdown Source Registry Design, Canonical Entity Mapping, Canonical Source Rules, Client dropdown flow, Client selection, code:mermaid (flowchart TD) (+10 more)

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (10): BrandLogo(), BrandLogoProps, sources, authSearchSchema, Route, signInSchema, signUpSchema, TabsContent (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.11
Nodes (16): code:sql (SELECT field_name, value), code:bash (git add db/schema.sql scripts/bootstrap-db.ts src/server/liv), code:ts (const RESET_TABLES = [), code:ts (export async function listLookupValues(fieldName: string) {), code:ts (lookup_values: ["id", "field_name", "value", "value_key", "c), code:ts (export const lookupValues = createServerFn({ method: "GET" }), code:tsx (<CommandInput placeholder={`Search ${label.toLowerCase()}...), code:tsx (<LookupCombobox) (+8 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 22 - "Community 22"
Cohesion: 0.12
Nodes (15): code:ts (const adminId = randomUUID();), code:bash (git commit -m "feat: harden phase 1 foundation"), code:bash (rm scripts/seed-dummy-data.ts), code:tsx (<TabsTrigger value="forgot">Recover</TabsTrigger>), code:ts (const { data, error } = await supabase.auth.resetPasswordFor), code:ts (const visible = (items: Item[]) =>), code:tsx (if (!hasRole("partner_user") && !hasRole("partner_admin") &&), code:tsx (const rows = ((data as DealRecord[] | null) ?? []).map((deal) (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.14
Nodes (10): CustomerForm, CustomersPage(), EMPTY_FORM, HEALTH_SCORE_OPTIONS, LAST_TOUCH_OPTIONS, DEAL_LOOKUP_FIELDS, ENTITY_DROPDOWN_FIELDS, LOOKUP_DROPDOWN_FIELDS (+2 more)

### Community 24 - "Community 24"
Cohesion: 0.24
Nodes (9): consumeLastCapturedError(), renderErrorPage(), fetch(), getServerEntry(), isH3SwallowedErrorBody(), normalizeCatastrophicSsrResponse(), ServerEntry, errorMiddleware (+1 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (12): Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext, CarouselOptions (+4 more)

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (7): LovableErrorOptions, LovableEvents, reportLovableError(), Window, Route, Toaster(), ToasterProps

### Community 27 - "Community 27"
Cohesion: 0.14
Nodes (12): code:ts (export const PARTNER_ONBOARDING_LOOKUP_FIELDS = {), code:tsx (<LookupCombobox), code:tsx (<LookupCombobox), code:ts (const id = await persistDraft();), code:ts (const path = `${id}/${docType.replace(/\W+/g, "_")}_${Date.n), code:tsx (<Dialog open={notesOpen} onOpenChange={setNotesOpen}>), code:bash (git add src/lib/partner-onboarding-lookups.ts src/lib/lookup), Phase 2 Onboarding Implementation Plan (+4 more)

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (13): code:tsx (// src/routes/_authenticated.tsx), code:tsx (// src/components/under-review-page.tsx), code:bash (npm run build), code:tsx (// selected user query), code:tsx (const approveUser = async () => {), code:tsx (<div className="flex flex-wrap gap-2">), code:bash (npm run build), code:bash (npm run build) (+5 more)

### Community 29 - "Community 29"
Cohesion: 0.14
Nodes (13): Acceptance Criteria, Assumptions, Composition Plan, LIVEY Internal Training Video Set Design, Narration Rules, Partner Admin Journey, Partner User Journey, Product Coverage (+5 more)

### Community 30 - "Community 30"
Cohesion: 0.14
Nodes (13): code:mermaid (flowchart TD), Definition of Done for the Full Program, Delivery Phases, LIVEY Partner Portal Phased Rollout Design, Phase 1: Platform Foundation, Phase 2: Partner Registration and Onboarding, Phase 3: Deal Lifecycle and Pipeline, Phase 4: Admin Operations and Governance (+5 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (9): AdminUsersPage(), PARTNER_STATUS_OPTIONS, Profile, ROLE_OPTIONS, RoleRow, UserRow, Badge(), BadgeProps (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.17
Nodes (9): FormControl, FormDescription, FormFieldContext, FormFieldContextValue, FormItem, FormItemContext, FormItemContextValue, FormLabel (+1 more)

### Community 34 - "Community 34"
Cohesion: 0.18
Nodes (7): ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent, THEMES

### Community 35 - "Community 35"
Cohesion: 0.18
Nodes (10): code:console (npm i), code:console (npm run dev), code:console (npx remotion render), code:console (npx remotion upgrade), Commands, Docs, Help, Issues (+2 more)

### Community 36 - "Community 36"
Cohesion: 0.2
Nodes (9): ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuShortcut(), ContextMenuSubContent (+1 more)

### Community 37 - "Community 37"
Cohesion: 0.2
Nodes (8): code:ts (export const CUSTOMER_STATUS_OPTIONS = ["active", "expansion), code:tsx (<Select value={draft.status} onValueChange={(value) => setDr), code:bash (# confirm the edit controls still save successfully), code:bash (git add src/lib/portal-demo-data.ts src/lib/demo-content.ts ), Dropdown Field Conversion Implementation Plan, Task 1: Add reusable option sources, Task 2: Convert edit forms to dropdowns, Task 3: Browser smoke test and commit

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (8): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle

### Community 40 - "Community 40"
Cohesion: 0.36
Nodes (7): ensureParentDirectory(), generateVoiceover(), generateVoiceoverTrack(), OUTPUT_ROOT, runCommand(), VOICEOVER_TRACKS, VoiceoverTrack

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 43 - "Community 43"
Cohesion: 0.25
Nodes (6): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle

### Community 44 - "Community 44"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger

### Community 45 - "Community 45"
Cohesion: 0.33
Nodes (5): ToggleGroup, ToggleGroupContext, ToggleGroupItem, Toggle, toggleVariants

### Community 46 - "Community 46"
Cohesion: 0.29
Nodes (5): AppShell(), UnderReviewPage(), AuthProvider(), Gate(), Route

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (6): Data Model, File Boundaries, Global Dropdown Lookups Design, Requirements, Runtime Flow, Testing

### Community 48 - "Community 48"
Cohesion: 0.4
Nodes (4): Alert, AlertDescription, AlertTitle, alertVariants

### Community 49 - "Community 49"
Cohesion: 0.5
Nodes (3): code:mermaid (flowchart TD), Coverage Notes, LIVEY Partner Portal System Flowchart

## Knowledge Gaps
- **460 isolated node(s):** `OUTPUT_ROOT`, `VoiceoverTrack`, `OUTPUT_ROOT`, `VOICEOVER_TRACKS`, `INTRO_FRAMES` (+455 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Community 16` to `Community 2`, `Community 4`, `Community 8`, `Community 9`, `Community 10`, `Community 12`, `Community 13`, `Community 14`, `Community 17`, `Community 19`, `Community 21`, `Community 25`, `Community 32`, `Community 33`, `Community 34`, `Community 36`, `Community 38`, `Community 39`, `Community 41`, `Community 42`, `Community 43`, `Community 44`, `Community 45`, `Community 48`?**
  _High betweenness centrality (0.134) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `Community 14` to `Community 32`, `Community 2`, `Community 4`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 12`, `Community 46`, `Community 17`, `Community 23`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `QueryBuilder` connect `Community 31` to `Community 0`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `OUTPUT_ROOT`, `VoiceoverTrack`, `OUTPUT_ROOT` to the rest of the system?**
  _460 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._