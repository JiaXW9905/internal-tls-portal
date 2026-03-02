# Internal TLS Portal User Guide

## 1. Audience
This guide is for end users of the portal, including:
- `service` (requester)
- `dev` (issuance operator)
- `admin` (administrator)
- `product` (overview reader)

## 2. Entry Points
- Login: `/login`
- Register: `/register`
- Forgot password: `/forgot`
- Certificate requests: `/`
- Certificate issuance: `/admin`
- Certificate overview: `/overview`
- Users & permissions (admin): `/users`
- System settings (admin): `/settings`
- Account settings: `/account`

> A version badge is displayed at the bottom-right of pages for environment/version verification.

## 3. Account Operations

### 3.1 Register
1. Open the register page and fill in name, company email, and verification code.
2. Click **Send verification code**.
3. Submit registration after receiving the code.
4. Initial password is `123456`; change it after first login.

### 3.2 Login
1. Open login page.
2. Enter email and password.
3. After login, menus are shown based on your role.

### 3.3 Forgot Password
1. Open forgot password page.
2. Enter email and send code.
3. Submit code and new password.

### 3.4 Change Password
1. Open **Account settings** from user menu.
2. Enter current password and new password, then save.

## 4. Requester (`service`) Operations

### 4.1 Create Request
1. Open **Certificate Request** page.
2. Fill customer name, SKU, VID, request type.
3. Click **Submit**.

### 4.2 View My Requests
1. Click **Load my requests**.
2. Check statuses:
   - `pending`
   - `issued`
   - `withdrawn`
   - `revoked`

### 4.3 Withdraw Request (pending only)
1. Find a `pending` row.
2. Click **Withdraw** and confirm.

### 4.4 Download Certificate ZIP
1. Only `issued` records with available files are downloadable.
2. If file metadata exists but file is missing, download action is disabled.
3. ZIP password is displayed when available.

## 5. Issuance (`dev/admin`) Operations

### 5.1 Process Pending Requests
1. Open **Certificate Issuance** page.
2. Select a pending request.
3. Upload ZIP and fill unzip password.
4. Submit to mark request as `issued`.

### 5.2 Recently Issued List
- Review recently issued records and certificate metadata.
- Revoke action is available if constraints are met.

### 5.3 Revoke Rules
- Revoke requires an active certificate record.
- Revoke is blocked if issued for more than 7 days.
- For expired revoke window, action column shows `-`.

## 6. Overview (`admin/dev/product`)

### 6.1 How to Use Overview
1. Open **Certificate Overview**.
2. Use filters:
   - keyword (customer/SKU/VID/requester)
   - start/end date
   - expiring within 60 days
3. Click **Search** to apply filters.
4. Click **Export CSV** to export current filtered results.

### 6.2 Expiry Display Rule
- Use explicit certificate expiry field when available.
- Otherwise compute and display `certificate_created_at + 730 days (365*2)`.

## 7. Admin-only Features

### 7.1 Users & Permissions
Admin can:
- update user role
- verify user email
- reset user password
- edit user profile (name/email/role)
- delete user (carefully)

### 7.2 System Settings
Admin can configure:
- SMTP settings (host/port/user/password/from)
- notification schedules (dev reminders/service digest/expiry alerts)
- key personnel email list (tag input)

## 8. FAQ

### Q1: I see `Failed to fetch` / data load failed
Possible reasons:
- service is down or port is unreachable
- wrong environment URL (localhost vs production confusion)
- backend runtime error in current release

Checks:
1. verify URL/environment
2. check `/api/health`
3. ask ops to inspect container logs

### Q2: Why can’t I see some records?
Data visibility is role- and account-scoped by design.  
Contact admin if you need broader access under approved policy.

### Q3: Request is issued but download is unavailable
Likely missing certificate file on disk/path mismatch.  
Ask issuance operator to re-upload certificate package.

## 9. Security Tips
- Change default/temporary passwords immediately.
- Avoid keeping sessions on shared/public devices.
- ZIP files and unzip passwords are sensitive; do not share externally.

