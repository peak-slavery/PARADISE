const INHERITED_RUNTIME_ENV = new Set([
  'APPDATA',
  'CI',
  'ComSpec',
  'COMSPEC',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCAL_ONLY',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'Path',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TZ',
  'USERPROFILE',
  'WINDIR',
]);

export function createBotChildEnv(parentEnv, ownEnv) {
  const inherited = Object.fromEntries(
    Object.entries(parentEnv).filter(([name]) => INHERITED_RUNTIME_ENV.has(name)),
  );
  return { ...inherited, ...ownEnv };
}
