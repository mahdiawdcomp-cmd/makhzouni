import { customAlphabet } from "nanoid";

// Serial format: XXXX-XXXX-XXXX-XXXX (uppercase alphanumeric, no ambiguous chars)
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const segment = customAlphabet(alphabet, 4);

export function generateSerialCode(): string {
  return `${segment()}-${segment()}-${segment()}-${segment()}`;
}
