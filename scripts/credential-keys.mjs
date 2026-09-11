export function resolveGroqAutomodKey({ explicit, normal }) {
  return explicit?.trim() || normal?.trim() || '';
}
