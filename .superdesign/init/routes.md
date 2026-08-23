# Routes — Page / Route Map

Next.js App Router. Route group `(app)` applies the authenticated shell (`src/app/(app)/layout.tsx`). `login` and `/` render bare.

| URL | File | Layout | Renders |
|---|---|---|---|
| `/` | `src/app/page.tsx` | root only | Client redirect → `/dashboard` if authed else `/login` ("Loading BeneFlow…") |
| `/login` | `src/app/login/page.tsx` | root only | Centered auth card, BeneFlow `BF` mark, login/register toggle (register adds Full Name + Company Name). Teal primary. |
| `/dashboard` | `src/app/(app)/dashboard/page.tsx` | AppLayout | Role-split. **HR Admin**: 4 stat cards (Benefit Categories, Pending Claims, Total Claims Paid $, Payroll Sync runs) + "Claims Requiring Review" list + "Offering Pools" list. **Employee**: stats (Available Perk Categories, My Pending Claims, Monthly Stipend Balance $, Total Reimbursed $) + "My Recent Claims" + "Browse Benefit Offerings". Subscription-status warning banner if org not active. |
| `/projects` | `src/app/(app)/projects/page.tsx` | AppLayout | "Benefits & Perks" — grid of BenefitCategory cards (name, description, `plan_count` plans badge, "Manage Claims & Plans →"). HR Admin sees "New Category" create form. |
| `/projects/[id]` | `src/app/(app)/projects/[id]/page.tsx` | AppLayout | Claims **Kanban board** for one category. 4 columns (Pending/In Review/Approved/Paid) of claim cards (title, `$amount`, priority badge, submitter avatar), drag-to-move, "+" submit-claim form. Clicking a card opens a right-side **claim detail panel** (amount, priority, submitter+dept, receipt link, description, status action buttons, discussion/audit log + comment box). |
| `/team` | `src/app/(app)/team/page.tsx` | AppLayout | "Employee Directory" — grid of employee cards (Avatar, name, email, 💼 department, 💵 stipend allowance left, role badge). |
| `/deployments` | `src/app/(app)/deployments/page.tsx` | AppLayout | "Payroll Integration & Sync" — table (Sync Destination, Sync Status badge, Batch ID mono, Exported by avatar, Date Synced). HR Admin: "Trigger Payroll Sync" button (gated by tier). |
| `/billing` | `src/app/(app)/billing/page.tsx` | AppLayout | "Billing & Subscriptions" — current plan card + 3 pricing tier cards (Starter $0 / Growth $49 / Enterprise $199) with feature lists; Stripe checkout / customer-portal (mock-aware). HR-Admin nav only. |
| `/compliance` | `src/app/(app)/compliance/page.tsx` | AppLayout | "HR Compliance Audits" — audit type select (401k Nondiscrimination / ACA / COBRA) + Run button (Enterprise-gated), upsell gradient banner, grid of audit result cards (score, findings by severity). Route exists but NOT in sidebar nav yet. |

**Key domain mapping (important):** the backend reuses generic models under benefits semantics — `BenefitCategory` is served at `/api/projects/`, benefit **claims** are `Task`s at `/api/tasks/`, **payroll syncs** are `Deployment`s at `/api/deployments/`, **compliance audits** are `SEOAudit`s at `/api/seo/audits/`. UI copy is fully benefits-domain; only the internal ids echo the old names.

**Roles:** `hr_admin` (privileged: create categories, review claims, trigger sync, run audits, billing), `employee` (browse, submit claims, see stipend), `partner` (Benefits Partner).
