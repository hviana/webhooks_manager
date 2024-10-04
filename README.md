# webhooks_manager

A webhook manager for Deno with guaranteed delivery and retry policy. You can
even restart the server, it is persistent.

## How to use

```typescript
import { WebhooksManager } from "https://deno.land/x/webhooks_manager/mod.ts";

const kv = await Deno.openKv(); //use your parameters here to launch a custom Deno.Kv
const manager = new WebhooksManager({ kv: kv });

await manager.init();

await manager.addWebhooks([
  "https://myrulexample.com",
  "https://myrsecondulexample.com",
]);

//Will be delivered to urls "https://myrulexample.com" and "https://myrsecondulexample.com"
const notificationIds = await manager.addNotifications([
  {
    ids: ["12379128471289"],
    event: "product_changed",
    extra: {
      bar: "foo",
    },
  },
]);
```

A webhook runs successfully only if it receives an http status 200. See the
"WebhooksManager" class for all other public methods and see type
'WebhooksManagerOptions' for all options:

```typescript
export type WebhooksManagerOptions = {
  kv: Deno.Kv;
  processInterval?: number;
  connectionTimeout?: number;
  namespace?: string;
  retryPolicy?: RetryPolicy; //(object, map numTries => delayMS), 1 to N, can't skip numbers, see defaultRetryPolicy example in lib code
  onWebhookError?: (
    e: ExecutionUnit,
  ) => Promise<void> | void;
  onWebhookSuccess?: (
    e: ExecutionUnit,
  ) => Promise<void> | void;
  onFailedAllAttempts?: (
    e: ExecutionUnit,
  ) => Promise<void> | void;
  deleteOnFailedAllAttempts?: boolean;
};
```

### All imports

```typescript
import {
  ExecutionUnit, //type
  Notification, //type
  RetryPolicy, //type
  WebhooksManager,
  WebhooksManagerOptions, //type
} from "https://deno.land/x/webhooks_manager/mod.ts";
```

## About

Author: Henrique Emanoel Viana, a Brazilian computer scientist, enthusiast of
web technologies, cel: +55 (41) 99999-4664. URL:
https://sites.google.com/view/henriqueviana

Improvements and suggestions are welcome!
