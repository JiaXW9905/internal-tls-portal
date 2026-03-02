# Internal TLS Portal Product Requirements Document (PRD)

## 1. Document Info
- Product: Internal TLS Certificate Portal
- Baseline release: `0.9.8.3`
- Purpose: define business goals, role permissions, workflows, and acceptance criteria as the single source of truth for go-live and handover.

## 2. Background and Goals
The system handles internal TLS certificate request, issuance, download, and lifecycle management. After multiple iterations (role split, revoke constraints, overview/export), formal product documentation is required before production launch.

### 2.1 Goals
- Make request/issuance/download auditable and maintainable.
- Enforce least-privilege access with role and data-scoping rules.
- Enable reliable upgrade and rollback with low release risk.

### 2.2 Non-Goals
- No direct CA automation (the portal manages process and file artifacts).
- No external SSO integration in current phase.
- No multi-tenant isolation in current phase (single internal instance).

## 3. Roles and Permissions
- `admin`: platform admin (user/settings management, issuance, overview).
- `dev`: issuance operator (issue/revoke/overview).
- `service`: requester (create/view/download own requests).
- `product`: overview-only role.

### 3.1 Data Visibility Rules (Critical)
- For request/issuance data APIs, `admin/dev` can only see records related to themselves by default:
  - requests created by themselves, or
  - certificates issued by themselves.
- `service` can only see own requests.
- `product` does not use issuance page, only overview.

## 4. Core Workflows
1. User registers (company email) and logs in.
2. Requester creates certificate request (customer/SKU/VID/type).
3. Admin/Dev uploads ZIP and issues certificate.
4. Requester downloads ZIP from "My Requests" (disabled if file is missing).
5. Revoke is allowed only within 7 days after issuance.
6. Overview supports filtering and CSV export.

## 5. Functional Requirements

### 5.1 Authentication and Account
- Register, login, logout, forgot password, change password.
- Email verification flows for registration and reset.
- Admin can manage users, roles, user profile, and password reset.

### 5.2 Request Management
- Request fields:
  - `customer_name`
  - `product_sku`
  - `vid`
  - `requester_name`
  - `request_type` (`new`/`delete`/`renew`)
- Withdraw action only for `pending` requests.

### 5.3 Issuance Management
- Only `admin/dev` can issue.
- Upload certificate ZIP and password.
- Status transitions to `issued` after success.

### 5.4 Certificate Revoke Constraints
- Revoke only when active certificate exists.
- Only `admin/dev` can revoke.
- Revoke is blocked if issued over 7 days ago.
- For expired-revoke window, UI action column should show `-`.

### 5.5 Certificate Overview
- Filters: status, keyword, date range, expiring soon (60 days).
- CSV export supported.
- Expiry display rule:
  - use explicit expiry field first when available;
  - otherwise compute `certificate_created_at + 730 days (365*2)`.

### 5.6 File Availability Behavior
- If record exists but file is missing:
  - disable download in "My Requests";
  - show clear missing-file state in overview/issuance pages.

### 5.7 Version Badge
- All pages show version badge in bottom-right, sourced from `public/version.js`.

## 6. Non-Functional Requirements
- Availability: core pages and APIs must be reliably accessible.
- Security: session auth + role auth + strict data scope.
- Operability: Docker deployment/upgrade/rollback supported.
- Traceability: `CHANGELOG.md` maintained for each release.

## 7. Data Model (Summary)
- `users`: account, role, verification.
- `requests`: request lifecycle, type, issued timestamp.
- `request_certificates`: file path/password/issuer/revoke metadata.
- `system_settings`: SMTP/system configs.

## 8. Acceptance Criteria (UAT)
- Role-based data scope works as defined.
- Overview can load and paginate datasets >200 rows.
- Missing expiry data is displayed as `issued + 730 days`.
- Revoke action is not available after 7 days.
- Missing-file records have disabled download in requester page.
- Version badge is visible and matches current release.

## 9. Risks and Constraints
- SQLite single-node architecture limits scale-out.
- Legacy/dirty data (missing files/fields) can affect consistency.
- Upgrade discipline (backup and rollback) is required.

## 10. Follow-up Docs
This PRD feeds:
- HLD
- User Operation Guide
- Developer/Ops Runbook (deploy, upgrade, rollback, troubleshooting)
- LLM context prompt for vibe coding

