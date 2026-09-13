# Command families

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

| Family            | Commands                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Semantic language | `language manifest`, `language schema`                                                         |
| Map authoring     | `init`, `validate`, `inspect`, `explain`, `semantic-diff`, `build`, `preview` (`dev` alias)    |
| Local evidence    | `setup capture`, `capture`, `visual compare`, `visual analyze`, `visual diff`, `visual update` |
| Data and assets   | `tileset inspect`, `tileset publish/list/status/purge`, `inspect features`, `icons list/diff`  |
| Account           | `login`, `logout`, `whoami`                                                                    |
| Hosted delivery   | `deploy`, `status`                                                                             |

Run `tileflow <command> --help` (or the family help, such as `tileflow icons --help`) for the exact
arguments and bounded JSON modes.

The CLI retains the hidden `projects` command family as a compatibility and support surface for the
internal application boundary. It is not part of the ordinary workflow or the product catalog.
