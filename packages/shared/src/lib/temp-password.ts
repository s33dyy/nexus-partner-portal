const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*";

function pick(charset: string) {
  const index = Math.floor(Math.random() * charset.length);
  return charset[index] ?? charset[0] ?? "";
}

function shuffle(value: string) {
  const chars = value.split("");
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [chars[index], chars[swapIndex]] = [chars[swapIndex]!, chars[index]!];
  }
  return chars.join("");
}

export function generateTemporaryPassword(length = 14) {
  const safeLength = Math.max(length, 14);
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const all = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

  while (required.length < safeLength) {
    required.push(pick(all));
  }

  return shuffle(required.join(""));
}
