import { z } from "zod";
import { TokenAudienceSchema, UserTypeSchema } from "../enums.js";
import {
  EmailSchema,
  IdSchema,
  PasswordSchema,
  TimestampSchema,
  VersionSchema,
} from "../common.js";
import { PermissionSchema } from "../permissions.js";

/** Staff login body (email + password, optional TOTP code). */
export const StaffLoginSchema = z.strictObject({
  email: EmailSchema,
  password: z.string().min(1).max(128),
  mfa_code: z.string().regex(/^\d{6}$/).optional(),
  device_name: z.string().trim().max(120).optional(),
});
export type StaffLogin = z.infer<typeof StaffLoginSchema>;

/** The authenticated staff user as returned by login and `GET /auth/me`. */
export const AuthUserSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  role_id: IdSchema,
  role_name: z.string(),
  is_system_role: z.boolean(),
  permissions: z.array(PermissionSchema),
  all_projects: z.boolean(),
  project_ids: z.array(IdSchema),
  must_change_password: z.boolean(),
  mfa_enabled: z.boolean(),
  avatar_url: z.string().nullable(),
  last_login_at: TimestampSchema.nullable(),
  version: VersionSchema,
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

/** Token pair issued on login/refresh. */
export const TokenPairSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.int().min(1),
  audience: TokenAudienceSchema,
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

/** Staff login success: tokens + user (`must_change_password` mirrored at the top level per API-CONVENTIONS Appendix A). */
export const StaffLoginSuccessSchema = TokenPairSchema.extend({
  mfa_required: z.literal(false).optional(),
  user: AuthUserSchema,
  must_change_password: z.boolean(),
});
export type StaffLoginSuccess = z.infer<typeof StaffLoginSuccessSchema>;

/** Staff login response; `mfa_required` means complete the login with `POST /auth/login/mfa`. */
export const StaffLoginResponseSchema = z.union([
  z.object({ mfa_required: z.literal(true), mfa_token: z.string() }),
  StaffLoginSuccessSchema,
]);
export type StaffLoginResponse = z.infer<typeof StaffLoginResponseSchema>;

/** Second step of an MFA login: the short-lived `mfa_token` from step one plus the TOTP code. */
export const StaffMfaLoginSchema = z.strictObject({ mfa_token: z.string().min(16), code: z.string().regex(/^\d{6}$/) });
export type StaffMfaLogin = z.infer<typeof StaffMfaLoginSchema>;

/** Company facts every staff client needs after login. */
export const AuthCompanySchema = z.object({
  id: IdSchema,
  name: z.string(),
  legal_name: z.string().nullable(),
  logo_url: z.string().nullable(),
  fy_start_month: z.int().min(1).max(12),
  settings: z.object({
    demand_due_days: z.int().min(0),
    default_gst_percent: z.number().min(0).max(100),
    round_robin_enabled: z.boolean(),
    force_mfa_for_admins: z.boolean(),
    booking_hold_hours: z.int().min(1),
  }),
});
export type AuthCompany = z.infer<typeof AuthCompanySchema>;

/** `GET /auth/me`: the caller and their company. */
export const AuthMeResponseSchema = z.object({ user: AuthUserSchema, company: AuthCompanySchema });
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

/** Refresh body. */
export const RefreshTokenSchema = z.strictObject({ refresh_token: z.string().min(16) });
export type RefreshToken = z.infer<typeof RefreshTokenSchema>;

/** Logout body (omit refresh_token to revoke only the current session). */
export const LogoutSchema = z.strictObject({ refresh_token: z.string().min(16).optional(), all_devices: z.boolean().default(false) });
export type Logout = z.infer<typeof LogoutSchema>;

/** Change own password. */
export const ChangePasswordSchema = z
  .strictObject({ current_password: z.string().min(1).max(128), new_password: PasswordSchema })
  .refine((v) => v.current_password !== v.new_password, { message: "New password must differ", path: ["new_password"] });
export type ChangePassword = z.infer<typeof ChangePasswordSchema>;

/** MFA setup response (secret shown once). */
export const MfaSetupResponseSchema = z.object({ secret: z.string(), otpauth_url: z.string(), qr_svg: z.string().optional() });
export type MfaSetupResponse = z.infer<typeof MfaSetupResponseSchema>;

/** Confirm MFA enrolment with a code from the authenticator. */
export const MfaEnableSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
export type MfaEnable = z.infer<typeof MfaEnableSchema>;

/** Disable MFA (password + current code). */
export const MfaDisableSchema = z.strictObject({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/) });
export type MfaDisable = z.infer<typeof MfaDisableSchema>;

/** One device/session row. */
export const SessionRowSchema = z.object({
  id: IdSchema,
  family_id: IdSchema,
  user_agent: z.string().nullable(),
  ip: z.string().nullable(),
  created_at: TimestampSchema,
  last_used_at: TimestampSchema.nullable(),
  expires_at: TimestampSchema,
  is_current: z.boolean(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

/** Revoke one session by id. */
export const RevokeSessionSchema = z.strictObject({ session_id: IdSchema });
export type RevokeSession = z.infer<typeof RevokeSessionSchema>;

/** Decoded access-token claims (shared by both audiences). */
export const AccessTokenClaimsSchema = z.object({
  sub: IdSchema,
  aud: TokenAudienceSchema,
  company_id: IdSchema,
  subject_type: UserTypeSchema,
  jti: z.string(),
  iat: z.int(),
  exp: z.int(),
  pv: z.int().min(0).optional(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

/** Login event (audit of attempts). */
export const LoginEventRowSchema = z.object({
  id: IdSchema,
  subject_type: UserTypeSchema,
  identifier: z.string(),
  success: z.boolean(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: TimestampSchema,
});
export type LoginEventRow = z.infer<typeof LoginEventRowSchema>;

/** Password policy as exposed to clients. */
export const PasswordPolicySchema = z.object({
  min_length: z.int().min(8),
  require_upper: z.boolean(),
  require_lower: z.boolean(),
  require_digit: z.boolean(),
  history_count: z.int().min(0),
  lockout_attempts: z.int().min(1),
  lockout_minutes: z.int().min(1),
});
export type PasswordPolicy = z.infer<typeof PasswordPolicySchema>;

/** The policy the API enforces. */
export const PASSWORD_POLICY: PasswordPolicy = {
  min_length: 10,
  require_upper: true,
  require_lower: true,
  require_digit: true,
  history_count: 5,
  lockout_attempts: 5,
  lockout_minutes: 15,
};

/** Failures across all client IPs (15 minutes) that lock the account itself; 5 from one IP lock only that IP (lockout_attempts). */
export const ACCOUNT_LOCKOUT_ATTEMPTS = 20;

/** One public verification key of `GET /auth/jwks` (Ed25519, RFC 8037). */
export const JwkSchema = z.object({ kty: z.string(), crv: z.string().optional(), x: z.string().optional(), kid: z.string(), use: z.string(), alg: z.string() });
export type Jwk = z.infer<typeof JwkSchema>;

/** `GET /auth/jwks`: every key that can still verify a live access token (the current one first, then JWT_PREVIOUS_SECRETS). */
export const JwksResponseSchema = z.object({ keys: z.array(JwkSchema) });
export type JwksResponse = z.infer<typeof JwksResponseSchema>;
