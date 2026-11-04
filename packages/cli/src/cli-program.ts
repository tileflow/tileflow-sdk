import {Command} from 'commander';
import pc from 'picocolors';

export function createCliProgram(): Command {
  return new Command()
    .name('tileflow')
    .description('Beautiful maps from config.')
    .enablePositionalOptions()
    .showHelpAfterError(pc.gray('\nRun tileflow <command> --help for usage.'))
    .showSuggestionAfterError()
    .addHelpText('after', '\n  -V, --version  output the version number\n');
}
