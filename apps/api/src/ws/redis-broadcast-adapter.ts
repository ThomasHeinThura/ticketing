import type Redis from "ioredis";
import * as v from "valibot";
import {
  closeRedis,
  forceCloseRedis,
  getRedisPub,
  getRedisSub,
  type RedisClient,
} from "../redis";
import type {
  BroadcastAdapter,
  BroadcastMessage,
  NativeBroadcastMessage,
  UserBroadcast,
} from "./broadcast-adapter";

const CHANNEL_PREFIX = "taskdesk:ws:";
const CHANNEL_SUFFIX = ":broadcast";
const CHANNEL_PATTERN = `${CHANNEL_PREFIX}*${CHANNEL_SUFFIX}`;

const USER_CHANNEL_PREFIX = "taskdesk:ws-user:";
const USER_CHANNEL_PATTERN = `${USER_CHANNEL_PREFIX}*${CHANNEL_SUFFIX}`;
const NATIVE_CHANNEL = "taskdesk:ws-native:broadcast";

const broadcastMessageSchema = v.object({
  projectId: v.string(),
  message: v.object({
    type: v.string(),
    projectId: v.string(),
    taskId: v.optional(v.string()),
    sourceTaskId: v.optional(v.string()),
    targetTaskId: v.optional(v.string()),
  }),
  excludeInitiatorId: v.optional(v.string()),
});

const userBroadcastSchema = v.object({
  userId: v.string(),
  message: v.looseObject({ type: v.string() }),
  origin: v.optional(v.string()),
});
const nativeBroadcastSchema = v.object({
  projectId: v.string(),
  topics: v.array(v.string()),
  eventId: v.string(),
  eventType: v.string(),
  at: v.string(),
  key: v.string(),
  customerVisible: v.boolean(),
});

export class RedisBroadcastAdapter implements BroadcastAdapter {
  private subscribed = false;
  private userSubscribed = false;
  private nativeSubscribed = false;
  private subscriber: RedisClient | null = null;
  private closing = false;
  private forced = false;

  constructor(private readonly clientFactory?: () => RedisClient) {}
  private _pmessageHandler:
    | ((pattern: string, channel: string, data: string) => void)
    | null = null;
  private _userPmessageHandler:
    | ((pattern: string, channel: string, data: string) => void)
    | null = null;
  private _nativeMessageHandler:
    | ((channel: string, data: string) => void)
    | null = null;

  async publish(msg: BroadcastMessage): Promise<void> {
    if (this.forced) return;
    await getRedisPub(this.clientFactory).publish(
      this.channelForProject(msg.projectId),
      JSON.stringify(msg),
    );
  }

  async publishToUser(msg: UserBroadcast): Promise<void> {
    if (this.forced) return;
    await getRedisPub(this.clientFactory).publish(
      this.channelForUser(msg.userId),
      JSON.stringify(msg),
    );
  }

  async publishNative(msg: NativeBroadcastMessage): Promise<void> {
    if (this.forced) return;
    await getRedisPub(this.clientFactory).publish(
      NATIVE_CHANNEL,
      JSON.stringify(msg),
    );
  }

  async subscribeToNative(
    handler: (msg: NativeBroadcastMessage) => void,
  ): Promise<void> {
    if (this.nativeSubscribed || this.closing) return;
    this.nativeSubscribed = true;
    const sub = getRedisSub(this.clientFactory);
    this.subscriber = sub;
    this._nativeMessageHandler = (channel, data) => {
      if (this.closing || channel !== NATIVE_CHANNEL) return;
      try {
        const parsed = v.safeParse(nativeBroadcastSchema, JSON.parse(data));
        if (!parsed.success) {
          console.error("Invalid native realtime broadcast:", parsed.issues);
          return;
        }
        handler(parsed.output);
      } catch (error) {
        console.error("Failed to parse native realtime broadcast:", error);
      }
    };
    (sub as Redis).on("message", this._nativeMessageHandler);
    await sub.subscribe(NATIVE_CHANNEL);
  }

  async subscribe(handler: (msg: BroadcastMessage) => void): Promise<void> {
    if (this.subscribed || this.closing) return;
    this.subscribed = true;
    const sub = getRedisSub(this.clientFactory);
    this.subscriber = sub;

    // Pattern-subscribe to ALL project channels at once
    // "pmessage" fires for pattern subscriptions (not "message")
    this._pmessageHandler = (
      pattern: string,
      _channel: string,
      data: string,
    ) => {
      if (this.closing || pattern !== CHANNEL_PATTERN) return;
      try {
        const parsed = v.safeParse(broadcastMessageSchema, JSON.parse(data));
        if (!parsed.success) {
          console.error("Invalid broadcast message:", parsed.issues);
          return;
        }
        handler(parsed.output);
      } catch (err) {
        console.error("Failed to parse broadcast message:", err);
      }
    };
    (sub as Redis).on("pmessage", this._pmessageHandler);
    await sub.psubscribe(CHANNEL_PATTERN);
  }

  async subscribeToUser(handler: (msg: UserBroadcast) => void): Promise<void> {
    if (this.userSubscribed || this.closing) return;
    this.userSubscribed = true;
    const sub = getRedisSub(this.clientFactory);
    this.subscriber = sub;

    this._userPmessageHandler = (
      pattern: string,
      channel: string,
      data: string,
    ) => {
      if (this.closing || pattern !== USER_CHANNEL_PATTERN) return;
      try {
        const parsed = v.safeParse(userBroadcastSchema, JSON.parse(data));
        if (!parsed.success) {
          console.error("Invalid user broadcast message:", parsed.issues);
          return;
        }
        if (channel !== this.channelForUser(parsed.output.userId)) {
          console.error("User broadcast channel and payload disagree");
          return;
        }
        handler(parsed.output as UserBroadcast);
      } catch (err) {
        console.error("Failed to parse user broadcast message:", err);
      }
    };
    (sub as Redis).on("pmessage", this._userPmessageHandler);
    await sub.psubscribe(USER_CHANNEL_PATTERN);
  }

  async shutdown(): Promise<void> {
    this.beginShutdown();
    if (this.forced) return;

    const sub = this.subscriber as Redis | null;
    const failures: unknown[] = [];

    if (sub && !this.forced) {
      try {
        await sub.punsubscribe(CHANNEL_PATTERN);
      } catch (error) {
        failures.push(error);
      }
    }
    if (sub && !this.forced) {
      try {
        await sub.punsubscribe(USER_CHANNEL_PATTERN);
      } catch (error) {
        failures.push(error);
      }
    }
    if (sub && !this.forced && this.nativeSubscribed) {
      try {
        await sub.unsubscribe(NATIVE_CHANNEL);
      } catch (error) {
        failures.push(error);
      }
    }
    if (!this.forced) {
      try {
        await closeRedis();
      } catch (error) {
        failures.push(error);
      }
    }

    this.subscriber = null;
    this.subscribed = false;
    this.userSubscribed = false;
    this.nativeSubscribed = false;

    if (failures.length > 0) {
      throw new AggregateError(failures, "WebSocket Redis shutdown failed");
    }
  }

  beginShutdown(): void {
    if (this.closing) return;
    this.closing = true;
    const sub = this.subscriber as Redis | null;
    if (this._pmessageHandler) {
      sub?.off("pmessage", this._pmessageHandler);
      this._pmessageHandler = null;
    }
    if (this._userPmessageHandler) {
      sub?.off("pmessage", this._userPmessageHandler);
      this._userPmessageHandler = null;
    }
    if (this._nativeMessageHandler) {
      (this.subscriber as Redis).off("message", this._nativeMessageHandler);
      this._nativeMessageHandler = null;
    }
  }

  forceShutdown(): void {
    if (this.forced) return;
    this.forced = true;
    this.beginShutdown();
    this.subscriber = null;
    forceCloseRedis();
  }

  private channelForProject(projectId: string): string {
    return `${CHANNEL_PREFIX}${projectId}${CHANNEL_SUFFIX}`;
  }

  private channelForUser(userId: string): string {
    return `${USER_CHANNEL_PREFIX}${userId}${CHANNEL_SUFFIX}`;
  }
}
