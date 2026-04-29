# Skill Registry

## Project Standards

### backend
- **Architecture**: Layered (routes -> controllers -> services)
- **Database**: Prisma ORM with PostgreSQL
- **RBAC**: Enforce permissions in controllers using `requirePermission` middleware.
- **Transactions**: Use `prisma.$transaction` for multi-step data mutations (e.g., voiding a sale and adjusting stock).
- **History**: Every stock movement MUST be recorded in `StockHistory` with a descriptive type (e.g., `RETURN` for voided sales).

### frontend
- **Framework**: React 19 + Vite
- **Styling**: Tailwind CSS 4
- **State Management**: Zustand
- **Components**: Functional components with hooks.
- **Permissions**: Conditionally render buttons based on user permissions from auth context.

## User Skills

| Skill | Trigger |
|-------|---------|
| branch-pr | Creating a pull request |
| issue-creation | Creating a GitHub issue |
| sdd-apply | Implementation phase |
| sdd-verify | Verification phase |
