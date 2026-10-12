/** Keep only ASCII digits for non-negative whole-number form inputs. */
export function sanitizeWholeNumber(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** Keep an optional leading minus and ASCII digits for signed whole-number inputs. */
export function sanitizeSignedWholeNumber(value: string): string {
  const sign = value.startsWith("-") ? "-" : "";
  return sign + sanitizeWholeNumber(value.slice(sign ? 1 : 0));
}

/** Keep ASCII digits and the first decimal point for decimal form inputs. */
export function sanitizeDecimal(value: string): string {
  let sawDecimalPoint = false;

  return Array.from(value).reduce((sanitized, character) => {
    if (character >= "0" && character <= "9") return sanitized + character;
    if (character === "." && !sawDecimalPoint) {
      sawDecimalPoint = true;
      return sanitized + character;
    }
    return sanitized;
  }, "");
}
