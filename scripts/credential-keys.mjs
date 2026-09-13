function valueFromAssignment(raw, name) {
  const pattern = new RegExp(`^\\s*(?:-\\s*)?${name}\\s*=\\s*"?([^"\\r\\n]+?)"?\\s*$`, 'im');
  return raw.match(pattern)?.[1]?.trim() || '';
}

export function resolveCredential({ raw = '', name, environment, descriptive }) {
  const explicit = environment?.trim() || valueFromAssignment(raw, name);
  if (explicit) return explicit;
  return descriptive ? raw.match(descriptive)?.[1]?.trim() || '' : '';
}

export function resolveCerebrasKey({ explicit }) {
  return explicit?.trim() || '';
}
