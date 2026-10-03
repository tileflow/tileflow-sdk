# Command families

Start with the [tileflow guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for installation and a complete first example.

| Family            | Commands                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Semantic language | `language manifest`, `language schema`                                                         |
| Map authoring     | `init`, `validate`, `inspect`, `explain`, `semantic-diff`, `build`, `preview` (`dev` alias)    |
| Local evidence    | `setup capture`, `capture`, `visual compare`, `visual analyze`, `visual diff`, `visual update` |
| Data and assets   | `tileset inspect`, `tileset publish/list/status/purge`, `inspect features`, `icons list/diff`  |
| Team Icon Sets    | `icon-set publish/list/status/versions/uses/archive/unarchive/purge`                           |
| Repository locks  | `icons install`, `icons update`, `icons pin`                                                   |
| Account           | `login`, `logout`, `whoami`                                                                    |
| Hosted delivery   | `deploy`, `status`                                                                             |

Run `tileflow <command> --help` (or the family help, such as `tileflow icons --help`) for the exact
arguments and bounded JSON modes. `preview` defaults to the existing web renderer. The explicit
`preview --renderer native` / `dev --renderer native` mode serves watched `native-v1` artifacts only;
Metro remains the React Native JavaScript development server. See
[Native artifacts and local preview](./native-artifacts.md) for the endpoint and qualification
boundary.

`icon-set` and `icons` are deliberately separate. `icon-set` needs Team authority and changes the
remote catalog. `icons list` and `icons diff` are keyless local inspection, and
`icons install|update|pin` are the only commands that resolve `latest` or write
`tileflow.icons.lock.json`. See the
[Team Icon Set workflow](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/team-icon-sets.md).

The CLI retains the hidden `projects` command family as a compatibility and support surface for the
internal application boundary. It is not part of the ordinary workflow or the product catalog.
