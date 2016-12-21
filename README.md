# hubot-issues

hubot scripts for tracking issues

See [`conversations.yaml`](https://github.com/benjamine/hubot-issues/blob/master/test/fixtures/conversations.yaml) for full documentation.

## Installation

In hubot project repo, run:

`npm install hubot-issues --save`

Then add **hubot-issues** to your `external-scripts.json`:

```json
[
  "hubot-issues"
]
```

## Sample Interaction

```
user1>> this thing is broken
hubot>> did you find a bug?, do you know how to report it?
user1>> how?
hubot>> ...
```
