# gamble bot

a double or nothing gambling bot for donutsmp

## setup

requires nodejs 18+

```
npm install
```

open `bot.js` and edit `CONFIG` at the top:

- `auth.username` - put anything here (change if the account gets banned to login to a new acc)
- `auth.authType` - set to `microsoft` 
- `startingBalance` - set to how much the bot starts with (not needed just nice to know)
- `winChance` - probability of a player winning (0.50 = 50%)
- `webhookUrl` - paste a discord webhook url to log results, leave empty to disable
- `server.host` - server ip
- `server.version` - minecraft version (1.20.4 reccommended for donut)

## usage

```
node bot.js
```

players pay the bot any amount and the bot rolls against the win chance if the player wins, the bot pays back double and if they lose the bot keeps the money

## config options

- `reconnectDelay` - ms before reconnecting after disconnect
- `cooldownMs` - per-player cooldown between bets
- `globalRateLimit` - max gambles per minute across all players
- `duplicateWindowMs` - window for ignoring duplicate payments
- `payConfirmTimeoutMs` - how long to wait for pay confirmation
- `webhookRateMs` - delay between discord webhook sends
