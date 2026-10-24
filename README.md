```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

# THIS PROJECT'S DOCUMENTATION
1. deploy `bun run deploy
Project address
```
https://commonvocab.developedbyluan.workers.dev
Current Version ID: 9236b200-0f39-4c7d-a061-c58518e171d3
```