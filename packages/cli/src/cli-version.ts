export function isRootCliVersionRequest(arguments_: readonly string[]): boolean {
  return arguments_.length === 1 && (arguments_[0] === '--version' || arguments_[0] === '-V');
}
