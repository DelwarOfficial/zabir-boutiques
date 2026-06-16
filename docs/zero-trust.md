# Zero Trust Access Policy [Master_Prompt v7.0 §9.4, G10]

All `/api/staff/*` and `/staff/*` routes are protected by Cloudflare
Zero Trust Access in addition to the cookie-based session auth + RBAC
enforced in `src/middleware.ts` and `src/lib/rbac.ts`.

## Cloudflare dashboard setup

1. Zero Trust → Access → Applications → Add application → Self-hosted
2. Application domain: `zabirboutiques.com`
3. Application paths:
   - `/api/staff/*`
   - `/staff/*` (excluding `/staff/login`)
4. Identity providers: One-time PIN sent to staff email (the same email
   used to log in to the staff dashboard).
5. Device posture (recommended):
   - OS version is at least Windows 11, macOS 13, iOS 16, or Android 13
   - Disk encryption is enabled
6. Session duration: 24 hours
7. Application purpose: Staff dashboard

## What it does

- Anyone hitting `/api/staff/*` without a valid Zero Trust session is
  redirected to the email-OTP challenge before ever reaching our Worker.
- After email-OTP, the staff member's session is bound to the device
  fingerprint. Re-authentication is required on a new device.
- Our Worker still runs `getCurrentStaffUser` + RBAC; Zero Trust is a
  second gate. Defense in depth: a stolen cookie alone is insufficient
  if the attacker is on an unknown device.

## Disabling Zero Trust for non-production

The policy must be created per-environment:
- `prod.zabirboutiques.com` → enforce
- `staging.zabirboutiques.com` → enforce, allow any staff email
- `dev.zabirboutiques.com` → bypass (for local dev)
