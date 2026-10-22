export function exitNotImplemented(scriptName: string): never {
  console.error(`${scriptName}: not implemented yet. See INSTRUCTIONS.md for the next milestone.`);
  process.exit(1);
}
