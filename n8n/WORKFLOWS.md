# n8n workflows

Built in n8n (project "D C", tag `discourse`). Error workflow of all three: `workflows-errors-ntfy` (`6YeRd2MBpoIleUlj`). Timezone: UTC.

| Workflow | id | Published |
|---|---|---|
| paper-trading-prices | `YdmuZPR4VuEaew4m` | no, blocked (see below) |
| paper-trading-ranking | `fzvv7c56koRWUzpK` | no, blocked (see below) |
| paper-trading-daily | `hhXrhnvESeqwkOlJ` | no, until the group message topic exists |

Blocker: on 2026-10-28 every Code node run failed with "Task request timed out" (the n8n task runner does not pick up Code tasks; the other workflows on this instance use no Code nodes). Fix the runner, run the backfill, check the first runs, then publish prices and ranking.

Data Table `paper_trading_keys`: id `cB0hW6kfXmqhErN2`, columns `user_id` (number), `key` (string), `created_at` (string, stored verbatim as the API returns it).

Store: artifact 39, `https://comunidad.criptonautas.co/discourse-ai/ai-bot/artifact-key-values/39.json`. Every HTTP node uses credential `Discourse account` (`discourseApi`, acts as `system`). Writes are `POST {key, value, public: true}`, deletes `DELETE ?key=`. Reads use `all_users=true&per_page=100` with n8n pagination (`page = $pageCount + 1`, stop when `has_more === false`, max 50 pages, 3 retries).

## paper-trading-prices

Triggers: `Every 5 min` (schedule) and `Manual Trigger` (backfill).

1. `pairs` (Code): one item per Kraken pair `{asset, pair, backfill}`; `backfill` is true only when `Manual Trigger` ran (`$('Manual Trigger').isExecuted`). Holds only the `KRAKEN_PAIRS` line of `dist/n8n-prices.js`.
2. `kraken` (HTTP GET): `https://api.kraken.com/0/public/OHLC?pair={{$json.pair}}&interval=240`, on error continue (a failing pair is skipped).
3. `weekly-keys` (Code, once for all items): full `dist/n8n-prices.js` + glue; builds `weeklyKeys(ohlc, now, backfill)` plus the `now` key. The glue matches each Kraken response to its pair by item index (`$('pairs').all()[i]`), never with `itemMatching`, which fails after an HTTP node in this mode.
4. `write-key` (HTTP POST): one request per item, `{key, value, public: true}`.
5. Prune branch from the schedule: `prune window 03:00 UTC` (IF `hour == 3 && minute < 5`) -> `read-old-pages` (paginated GET) -> `find-old` (Code: system `candles-*` keys whose `t0` is older than `weekStart(now) - 26 weeks`; aborts if the fetch is partial) -> `delete-key` (HTTP DELETE `?key=`). Holds `weekStart` only.

Backfill: open the workflow in n8n and run it from `Manual Trigger` ("Execute workflow" on that trigger), or `execute_workflow` with `triggerNodeName: "Manual Trigger"`. It writes every weekly key Kraken's 720 candles cover (about 36) and `now`. Safe to repeat.

Status: prices and ranking published on 2026-10-28; daily unpublished until the group message topic exists. Task runner: external, one runner pointed at `n8n-worker:5679` (queue mode); manual executions are offloaded to the worker.

## paper-trading-ranking

Trigger: hourly at minute 7.

1. `topic` (Set): `topic_id = 7161` (test topic). **Change the topic id here.**
2. `read-all-pages` (HTTP GET, paginated): every key of every user.
3. `merge-pages` (Code): joins the pages, attaches `user.username` to each non-system key (`user_id` mapped through the `users` of all pages), and throws (nothing is written) if there are no pages, a page lacks `key_values`, or the last page still has `has_more`.
4. `read-seen` (Data Table, get all rows, always output).
5. `rank` (Code): full `dist/n8n-ranking.js` + glue; `mergeCandles` takes the full list, `rankAll` only users (`user_id !== -1`). Outputs `{ranking, newSeen, flagged}`.
6. `write-ranking` (HTTP POST): key `ranking`, public.
7. `split-new-seen` -> `insert-seen` (Data Table insert `user_id`, `key`, `created_at`).
8. `any flagged?` (IF `flagged.length > 0`) -> `notify-flag` (POST `/posts.json` to `topic_id` from `topic`, text with the flagged user ids). Note: it repeats every hour while a user stays flagged.
9. Group branch, after `rank`: `group` (HTTP GET `/groups/paper-trading.json`, credential required, continue on error) -> `any-rows?` (IF ranking `rows` not empty) -> `add-members` (HTTP PUT `/groups/{group.id}/members.json`, `usernames` = every `rows[].u` comma-separated, retry 3, continue on error so the ranking write is never affected). It only adds members to the `paper-trading` group (so the daily summary reaches traders); it never removes anyone.

## paper-trading-daily

Trigger: cron `5 12 * * *` UTC.

1. `topic` (Set): `topic_id = 7161`. **Change the topic id here too.**
2. `read-all-pages`, `merge-pages`: same as ranking.
3. `summary` (Code): full `dist/n8n-daily.js` + glue; returns no item when nothing happened in the last 24 h.
4. `post-summary` (HTTP POST `https://comunidad.criptonautas.co/posts.json`, `{topic_id, raw}`) as system.

When the group message exists: set its id in `topic` in both workflows (ranking and daily), then publish `paper-trading-daily`.

## Code node paste procedure

After `python3 build.py`, open the node, select all of the code and paste the whole file over it:

- `weekly-keys` <- `dist/n8n-prices.js`, then the glue below it
- `rank` <- `dist/n8n-ranking.js`, then the glue below it
- `summary` <- `dist/n8n-daily.js`, then the glue below it

The glue (the lines after the engine) is already in the nodes; keep it, only replace the part above it. `python3 paperctl.py publish` updates the artifact, not these nodes. n8n requires publishing a workflow again after editing it.
