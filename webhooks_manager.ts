/*
Created by: Henrique Emanoel Viana
Githu: https://github.com/hviana
Page: https://sites.google.com/view/henriqueviana
cel: +55 (41) 99999-4664
*/

import { crypto } from "./deps.ts";

const defaultRetryPolicy = {
  1: 10 * 1000, //sec
  2: 30 * 1000, //sec
  3: 90 * 1000, //sec
  4: 3 * 60 * 1000, //min
  5: 12 * 60 * 1000, //min
  6: 36 * 60 * 1000, //min
  7: 60 * 60 * 1000, //min
  8: 2 * 60 * 60 * 1000, //hour
  9: 4 * 60 * 60 * 1000, //hour
  10: 6 * 60 * 60 * 1000, //hour
  11: 8 * 60 * 60 * 1000, //hour
  12: 12 * 60 * 60 * 1000, //hour
  13: 16 * 60 * 60 * 1000, //hour
  14: 24 * 60 * 60 * 1000, //hour
  15: 2 * 24 * 60 * 60 * 1000, //day
  16: 3 * 24 * 60 * 60 * 1000, //day
  17: 4 * 24 * 60 * 60 * 1000, //day
  18: 5 * 24 * 60 * 60 * 1000, //day
  19: 6 * 24 * 60 * 60 * 1000, //day
};

const defaultNotificationsOptions = {
  processInterval: 10000,
  connectionTimeout: 30000,
  namespace: "GLOBAL",
  retryPolicy: defaultRetryPolicy,
  onWebhookError: (e: ExecutionUnit) => undefined,
  onWebhookSuccess: (e: ExecutionUnit) => undefined,
  onFailedAttempts: (e: ExecutionUnit) => undefined,
  deleteOnFailedAttempts: false,
};

export type RetryPolicy = {
  [key: number]: number;
};

export type ExecutionUnit = {
  notification_id: string;
  webhook: string;
  error?: {
    last_error: string;
    last_error_date: string;
    attempts: number;
  };
};
export type Notification = {
  id?: string;
  ids?: string[];
  event: string;
  extra?: any;
  created_at?: string;
};

export type WebhooksManagerOptions = {
  kv: Deno.Kv;
  processInterval?: number;
  connectionTimeout?: number;
  namespace?: string;
  retryPolicy?: RetryPolicy; //(object, map tries => delayMS), 1 to N, can't skip numbers, see defaultRetryPolicy example
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

export class WebhooksManager {
  #options: WebhooksManagerOptions;
  #processingExecutioUnits: { [key: string]: boolean } = {};
  #retryPolicyKeys: number[];
  constructor(options: WebhooksManagerOptions) {
    this.#options = { ...defaultNotificationsOptions, ...options };
    this.#retryPolicyKeys = Object.keys(this.#options.retryPolicy!).map((
      i,
    ) => parseInt(i));
    this.#processWebHooks();
  }
  async getNotification(id: string): Promise<Notification> {
    return (await this.#options.kv.get([
      "wm_notifications",
      this.#options.namespace!,
      id,
    ])).value as Notification;
  }
  async getWebhook(w: string): Promise<string> {
    return (await this.#options.kv.get([
      "wm_webhooks",
      this.#options.namespace!,
      w,
    ]))
      .value as string;
  }
  async deleteNotification(id: string): Promise<void> {
    await this.#options.kv.delete([
      "wm_notifications",
      this.#options.namespace!,
      id,
    ]);
  }
  async deleteWebhook(w: string): Promise<void> {
    await this.#options.kv.delete(["wm_webhooks", this.#options.namespace!, w]);
  }
  async getNotifications(): Promise<Notification[]> {
    const res: Notification[] = [];
    const iter = this.#options.kv.list({
      prefix: ["wm_notifications", this.#options.namespace!],
    });
    for await (const data of iter) {
      res.push(data.value as Notification);
    }
    return res;
  }
  async getWebhooks(): Promise<string[]> {
    const res: string[] = [];
    const iter = this.#options.kv.list({
      prefix: ["wm_webhooks", this.#options.namespace!],
    });
    for await (const data of iter) {
      res.push(data.value as string);
    }
    return res;
  }
  async addNotifications(notifications: Notification[]): Promise<string[]> {
    const ids: string[] = [];
    const webhooks = await this.getWebhooks();
    for (const n of notifications) {
      n.created_at = (new Date()).toISOString();
      const id = crypto.randomUUID();
      n.id = id;
      await this.#setNotification(n);
      ids.push(id);
      for (const w of webhooks) {
        await this.#setExecutionUnit({
          notification_id: n.id!,
          webhook: w,
        });
      }
    }
    return ids;
  }
  async addWebhooks(webhooks: string[]): Promise<void> {
    for (const w of webhooks) {
      try {
        const url = new URL(w);
      } catch (e) {
        throw new Error(`invalid url: ${w}`);
      }
    }
    for (const w of webhooks) {
      await this.#setWebhook(w);
    }
  }

  async deleteAllNotifications(): Promise<void> {
    const notifications = await this.getNotifications();
    for (const n of notifications) {
      await this.deleteNotifications([n.id!]);
    }
  }
  async deleteAllWebhooks(): Promise<void> {
    const webhooks = await this.getWebhooks();
    await this.deleteWebhooks(webhooks);
  }
  async deleteNotifications(notificationsIds: string[]): Promise<void> {
    for (const id of notificationsIds) {
      await this.deleteNotification(id);
    }
  }
  async deleteWebhooks(webhooks: string[]): Promise<void> {
    for (const w of webhooks) {
      await this.deleteWebhook(w);
    }
  }

  async getErrors(): Promise<ExecutionUnit[]> {
    const executionUnits = await this.#getExecutionUnits();
    const res: ExecutionUnit[] = [];
    for (const e of executionUnits) {
      if (e.error) {
        res.push(e);
      }
    }
    return res;
  }

  async #processWebHook(
    e: ExecutionUnit,
    onError: boolean = false,
  ): Promise<void> {
    this.#processingExecutioUnits[e.notification_id + e.webhook] = true;
    if (
      !(await this.getWebhook(e.webhook)) ||
      !(await this.getNotification(e.notification_id))
    ) {
      await this.#deleteExecutionUnit(e);
      delete this.#processingExecutioUnits[e.notification_id + e.webhook];
      return;
    }
    try {
      if (e.error && !onError) {
        setTimeout(
          async () => await this.#processWebHook(e, true),
          this.#options.retryPolicy![
            e.error.attempts %
            (this.#retryPolicyKeys[this.#retryPolicyKeys.length - 1] +
              1)
          ],
        );
        return;
      }
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(),
        this.#options.connectionTimeout!,
      );
      const res = await fetch(
        e.webhook,
        {
          method: "POST",
          signal: controller.signal,
          headers: new Headers({
            "Content-Type": "application/json; charset=utf-8",
          }),
          body: JSON.stringify(await this.getNotification(e.notification_id)),
        },
      );
      if (res.status !== 200) {
        throw new Error(res.status.toString());
      }
      await this.#deleteExecutionUnit(e);
      if (
        (await this.#getExecutionUnitsOfNotification(e.notification_id))
          .length === 0
      ) {
        await this.deleteNotification(e.notification_id);
      }
      delete this.#processingExecutioUnits[e.notification_id + e.webhook];
      this.#options.onWebhookSuccess!(e);
    } catch (ex) {
      if (!e.error) {
        e.error = {
          last_error: "",
          last_error_date: "",
          attempts: 0,
        };
      }
      e.error!.last_error_date = (new Date()).toISOString();
      e.error!.last_error = ex.message || ex;
      e.error!.attempts++;
      await this.#setExecutionUnit(e);
      if (
        e.error!.attempts >=
          this.#retryPolicyKeys[this.#retryPolicyKeys.length - 1]
      ) {
        if (this.#options.deleteOnFailedAllAttempts!) {
          await this.#deleteExecutionUnit(e);
          if (
            (await this.#getExecutionUnitsOfNotification(e.notification_id))
              .length === 0
          ) {
            await this.deleteNotification(e.notification_id);
          }
          delete this.#processingExecutioUnits[e.notification_id + e.webhook];
          this.#options.onFailedAllAttempts!(e);
        }
      } else {
        this.#options.onWebhookError!(e);
        setTimeout(
          async () => await this.#processWebHook(e, true),
          this.#options.retryPolicy![
            e.error!.attempts %
            (this.#retryPolicyKeys[this.#retryPolicyKeys.length - 1] + 1)
          ],
        );
      }
    }
  }
  async #setWebhook(w: string): Promise<void> {
    await this.#options.kv.set(["wm_webhooks", this.#options.namespace!], w);
  }

  async #setNotification(n: Notification): Promise<void> {
    await this.#options.kv.set([
      "wm_notifications",
      this.#options.namespace!,
      n.id as string,
    ], n);
  }
  async #setExecutionUnit(eu: ExecutionUnit): Promise<void> {
    await this.#options.kv.set([
      "wm_execution_units",
      this.#options.namespace!,
      eu.notification_id,
      eu.webhook,
    ], eu);
  }
  async #deleteExecutionUnit(eu: ExecutionUnit): Promise<void> {
    await this.#options.kv.delete([
      "wm_execution_units",
      this.#options.namespace!,
      eu.notification_id,
      eu.webhook,
    ]);
  }
  async #getExecutionUnits(): Promise<ExecutionUnit[]> {
    const res: ExecutionUnit[] = [];
    const iter = this.#options.kv.list({
      prefix: ["wm_execution_units", this.#options.namespace!],
    });
    for await (const data of iter) {
      res.push(data.value as ExecutionUnit);
    }
    return res;
  }
  async #getExecutionUnitsOfNotification(
    notification_id: string,
  ): Promise<ExecutionUnit[]> {
    const res: ExecutionUnit[] = [];
    const iter = this.#options.kv.list({
      prefix: [
        "wm_execution_units",
        this.#options.namespace!,
        notification_id,
      ],
    });
    for await (const data of iter) {
      res.push(data.value as ExecutionUnit);
    }
    return res;
  }
  async #processWebHooks(): Promise<void> {
    const executionUnits = await this.#getExecutionUnits();
    for (const e of executionUnits) {
      if (!this.#processingExecutioUnits[e.notification_id + e.webhook]) {
        this.#processWebHook(e); //no await on purpose, can't block!
      }
    }
    setTimeout(
      async () => await this.#processWebHooks(),
      this.#options.processInterval!,
    );
  }
}
