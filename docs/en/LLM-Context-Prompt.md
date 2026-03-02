# Internal TLS Portal - LLM Quick Context Prompt Pack (EN)

## 1. How to Use
Use this file when you switch models or start a new chat session.

Recommended flow:
1. Paste the **Base Context Prompt**
2. Paste one **Task Template Prompt**
3. Add your concrete goal and constraints

---

## 2. Base Context Prompt (General)

```text
You are a collaborating engineer for this project. Work with the following context:

[Project]
Internal TLS Certificate Portal

[Stack]
- Node.js + Express (monolith)
- SQLite (data/app.db)
- Frontend: public/*.html + public/*.js (vanilla JS)
- Docker + docker-compose deployment

[Key Paths]
- Backend entry: src/server.js
- DB initialization: src/db.js
- Deploy scripts: deploy/package.sh, deploy/docker-entrypoint.sh
- Compose file: docker-compose.yml
- Persistent dirs: data/, uploads/
- Docs: docs/zh-CN, docs/en

[Critical Business Rules]
1) Roles: admin/dev/service/product
2) Data scope: for request/issuance related data, admin/dev should only see self-related records by default (submitted by self OR issued by self)
3) Revoke rule: certificates issued over 7 days ago cannot be revoked
4) Expiry rule in overview: if explicit expiry is missing, compute cert_created_at + 730 days (365*2)
5) If certificate file is missing, download action must be disabled with clear hint
6) Version badge must be visible at bottom-right (public/version.js)

[Quality Requirements]
- Do not change existing business rules unless explicitly requested
- Explain impact/risk before major edits
- After changes, provide minimal verification steps (>=3)
- Output must include: changes, reasons, validation, rollback suggestion
```

---

## 3. Task Template Prompts

### 3.1 Feature Request / Small Enhancement
```text
Implement the following requirement without breaking existing business rules:
[your requirement]

Constraints:
- Keep role and permission logic unchanged unless I explicitly ask
- Keep backward compatibility for APIs unless approved
- Provide a short implementation plan before editing
- After implementation, output:
  1) changed files
  2) risk points
  3) validation steps
```

### 3.2 Bug Fix
```text
Handle this issue in the sequence: locate -> root cause -> fix -> validate -> rollback.
[error symptom/log]

Requirements:
- Identify root cause first, avoid blind edits
- Prefer minimal and safe changes
- Explicitly state whether existing behavior is impacted
- Provide executable validation commands/steps
```

### 3.3 Pre-release Regression Checklist
```text
Create a pre-release regression checklist for this project, sorted by risk.

Must cover:
- login/register/forgot password
- request -> issue -> download main flow
- overview filtering/pagination/export
- revoke >7 days constraint
- data visibility (admin/dev/service/product)
- version badge

Output format:
- test case name
- precondition
- steps
- expected result
- risk level
```

### 3.4 Upgrade & Rollback Review
```text
I am upgrading from [old version] to [new version]. Review the upgrade and rollback plan.

Focus on:
- persistent mount paths for data/uploads
- env.prod reuse correctness
- port/container name conflict risks
- rollback executable within 10 minutes

Output:
1) pre-upgrade checklist
2) shortest safe execution steps
3) failure rollback steps
4) 5-minute post-release validation checklist
```

---

## 4. Output Style Constraint Prompt (Optional)

```text
Respond in concise engineering style.
Use this structure:
1) Conclusion (1-3 sentences)
2) Key change points (bullets)
3) Risks and compatibility impact
4) Validation steps (executable)
5) Rollback suggestion
```

---

## 5. One-shot Combined Example

```text
You are a collaborating engineer for this project:
- Project: Internal TLS Certificate Portal
- Stack: Node.js + Express + SQLite + Docker
- Rules:
  1) admin/dev only see self-related data by default
  2) certificates issued >7 days cannot be revoked
  3) if expiry missing, use cert_created_at + 730 days
  4) missing files => download disabled
  5) version badge visible at bottom-right

Task: fix “incorrect pagination count in certificate overview”.

Requirements:
- provide diagnosis and minimal-change plan first
- include changes, risks, validation, rollback
- concise and concrete
```

---

## 6. Maintenance Notes
- Update “Critical Business Rules” whenever policy changes.
- Add new task templates for frequent scenarios.
- Keep this file aligned with:
  - `docs/en/PRD.md`
  - `docs/en/HLD.md`
  - `docs/en/Developer-Runbook.md`

