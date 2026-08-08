# assets

Optional media referenced from `data/*.json`.

## `waaagh.gif`

The background flourish played when the WAAAGH! button is pressed — it fades in and
out over three seconds at low opacity behind the UI. Referenced by the `callGif` key
on the `waaagh` ability in `data/abilities.json`.

**This file is not in the repo.** Drop your own GIF here as `waaagh.gif`. Until you do,
the app is unaffected: the button plays its normal shake/flash and the missing file is
handled silently — the code gives up after the first failed load rather than retrying
on every press.

Keep it small. It is fetched and decoded once while the app is idle so that pressing
the button plays it instantly, but a multi-megabyte GIF still costs mobile data on
every visit and memory while it plays. A few hundred KB at modest dimensions is
plenty — it renders at 20% opacity behind everything, so detail is wasted.

To turn the flourish off entirely, delete the `callGif` key from the ability.
