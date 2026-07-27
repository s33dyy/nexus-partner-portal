type PasswordChangeInput = {
  password: string;
  confirmPassword: string;
};

type PasswordChangeValidationResult =
  | {
      ok: true;
      message: null;
    }
  | {
      ok: false;
      message: string;
    };

const STRONG_PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,128}$/;

export function validatePasswordChange({
  password,
  confirmPassword,
}: PasswordChangeInput): PasswordChangeValidationResult {
  if (!STRONG_PASSWORD_PATTERN.test(password)) {
    return {
      ok: false,
      message: "Password must include upper, lower, number, and symbol characters",
    };
  }

  if (password !== confirmPassword) {
    return {
      ok: false,
      message: "Passwords do not match",
    };
  }

  return {
    ok: true,
    message: null,
  };
}
