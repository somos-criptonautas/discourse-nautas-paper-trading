# n8n workflows

Built in n8n (project "D C", tag `discourse`). Error workflow of all three: `workflows-errors-ntfy` (`6YeRd2MBpoIleUlj`). Timezone: UTC.

| Workflow | id | Published |
|---|---|---|
| paper-trading-prices | `YdmuZPR4VuEaew4m` | yes, every 5 min |
| paper-trading-ranking | `fzvv7c56koRWUzpK` | yes, hourly at :07 |
| paper-trading-daily | `hhXrhnvESeqwkOlJ` | yes, daily 12:05 UTC |

Task runner: external, one runner pointed at `n8n-worker:5679` (queue mode); manual executions are offloaded to the worker.

Data Table `paper_trading_keys`: id `cB0hW6kfXmqhErN2`, columns `user_id` (number), `key` (string), `created_at` (string, stored verbatim as the API returns it).

Store: artifact 39, `https://comunidad.criptonautas.co/discourse-ai/ai-bot/artifact-key-values/39.json`. Every HTTP node uses credential `Discourse account` (`discourseApi`, acts as `system`). Writes are `POST {key, value, public: true}`, deletes `DELETE ?key=`. Reads use `all_users=true&per_page=100` with n8n pagination (`page = $pageCount + 1`, stop when `has_more === false`, max 50 pages, 3 retries).

## paper-trading-prices

Triggers: `Every 5 min` (schedule) and `Manual Trigger` (backfill).

1. `pairs` (Code): one item per Kraken pair `{asset, pair, backfill}`; `backfill` is true only when `Manual Trigger` ran (`$('Manual Trigger').isExecuted`). Holds only the `KRAKEN_PAIRS` line of `dist/n8n-prices.js`.
2. `kraken` (HTTP GET): `https://api.kraken.com/0/public/OHLC?pair={{$json.pair}}&interval=240`, on error continue (a failing pair is skipped).
3. `weekly-keys` (Code, once for all items): full `dist/n8n-prices.js` + glue; builds `weeklyKeys(ohlc, now, backfill)` plus the `now` key. A group key (`-a` or `-b`) is skipped when any of its three pairs failed, so a Kraken error never blanks two weeks of candles; `now` keeps only the pairs that answered. The glue matches each Kraken response to its pair by item index (`$('pairs').all()[i]`), never with `itemMatching`, which fails after an HTTP node in this mode.
4. `write-key` (HTTP POST): one request per item, `{key, value, public: true}`.
5. Prune branch from the schedule: `prune window 03:00 UTC` (IF `hour == 3 && minute < 5`) -> `read-old-pages` (paginated GET) -> `find-old` (Code: system `candles-*` keys whose `t0` is older than `weekStart(now) - 26 weeks`; aborts if the fetch is partial) -> `delete-key` (HTTP DELETE `?key=`). Holds `weekStart` only.

Backfill: open the workflow in n8n and run it from `Manual Trigger` ("Execute workflow" on that trigger), or `execute_workflow` with `triggerNodeName: "Manual Trigger"`. It writes every weekly key Kraken's 720 candles cover (about 36) and `now`. Safe to repeat.

## paper-trading-ranking

Trigger: `Hourly at :07`.

1. `topic` (Set): `topic_id` 7161 (test topic), only used by `notify-flag`.
2. `read-all-pages` (HTTP GET, paginated as above) -> `merge-pages` (Code): joins every page, adds `user: { username }` from the `users[]` of all pages, aborts on a partial fetch.
3. `read-seen` (Data Table get, `paper_trading_keys`, all rows, always outputs).
4. `rank` (Code): full `dist/n8n-ranking.js` + glue; `rankAll` returns `{ ranking, newSeen, flagged }`. A user is flagged when a seen key newer than their last reset vanished (or came back with another `created_at`), or when an `o-*`/`reset-*` key newer than their last reset has `updated_at` different from `created_at` (Discourse keeps `created_at` on overwrite). Flagged users are left out of the ranking.
5. From `rank`, four branches:
   - `write-ranking` (HTTP POST): public key `ranking`.
   - `split-new-seen` (Split Out `newSeen`) -> `insert-seen` (Data Table insert `user_id`, `key`, `created_at`).
   - `any flagged?` (IF `flagged.length > 0`) -> `notify-flag` (HTTP POST to `topic`). **Disabled**: it posted user ids to the public test topic every hour; enable it once staff notices have a private destination.
   - `group` (HTTP GET `/groups/paper-trading.json`) -> `members` (HTTP GET `/groups/paper-trading/members.json?limit=1000`, retry 3) -> `any-new?` (IF: ranked usernames not yet in `members` > 0) -> `add-members` (HTTP PUT `/groups/<id>/members.json` with only those usernames; on error continue). Only adds, never removes.

## paper-trading-daily

Trigger: `Daily 12:05 UTC`.

1. `read-all-pages`, `merge-pages`: same as ranking.
2. `summary` (Code): full `dist/n8n-daily.js` + glue; returns no item when fewer than 3 people traded in the last 24 h (a smaller count would point at people).
3. `daily-topic` (Code): reads `topicId` from workflow static data and returns `{ raw, topicId }`.
4. `has-topic?` (IF): `topicId` is a number.
   - true: `post-summary` (HTTP POST `https://comunidad.criptonautas.co/posts.json`, `{topic_id, raw}`) as system replies in the existing message.
   - false: `create-pm` (HTTP POST `/posts.json`, `archetype: private_message`, `target_recipients: paper-trading`, title `paper trading: resumen diario`, retry 3), then `save-topic` (Code) stores the new `topic_id` in static data.

The first summary creates the group message; later ones reply in it. The topic id lives in workflow static data, which only persists for production runs (manual runs do not save it). To start a new thread, clear the static data or delete `topicId`.

## Code node paste procedure

After `python3 build.py`, open the node, select all of the code and paste the whole file over it:

- `weekly-keys` <- `dist/n8n-prices.js`, then the glue below it
- `rank` <- `dist/n8n-ranking.js`, then the glue below it
- `summary` <- `dist/n8n-daily.js`, then the glue below it

The glue (the lines after the engine) is already in the nodes; keep it, only replace the part above it. `python3 paperctl.py publish` updates the artifact, not these nodes. n8n requires publishing a workflow again after editing it.
