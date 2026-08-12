import { createServerFn } from "@tanstack/react-start";

// Client bridge for the two-step account creation flow. Every one of these
// is anonymous by design (there is no session yet) — the abuse controls and
// uniqueness checks live server-side in signup-verification.server.ts.

const signupVerificationRequiredFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ required: boolean }> => {
    const { isSignupVerificationRequired } = await import("@/server/signup-verification.server");
    return { required: isSignupVerificationRequired() };
  },
);

const requestSignupOtpFn = createServerFn({ method: "POST" })
  .validator((input: { email: string; phoneE164: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; required: boolean }> => {
    const { requestSignupPhoneVerification } = await import("@/server/signup-verification.server");
    return requestSignupPhoneVerification(data);
  });

const signUpVerifiedFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      full_name: string;
      email: string;
      phone: string;
      company_name: string | null;
      password: string;
      code?: string | null;
    }) => input,
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { verifyAndSignUp } = await import("@/server/signup-verification.server");
    await verifyAndSignUp(data);
    // Deliberately returns nothing about the new account: signUpLocal already
    // set the session cookie, and the client re-reads identity through the
    // ordinary auth bridge rather than trusting a payload from here.
    return { ok: true };
  });

/** Whether this deployment can actually send an OTP (Twilio Verify configured). */
export async function isSignupOtpRequired(): Promise<boolean> {
  const result = await signupVerificationRequiredFn();
  return result.required;
}

export async function requestSignupOtp(input: { email: string; phoneE164: string }) {
  return requestSignupOtpFn({ data: input });
}

export async function signUpVerified(input: {
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  password: string;
  code?: string | null;
}) {
  return signUpVerifiedFn({ data: input });
}
