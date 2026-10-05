export type ProjectBroadcastMessage = {
  type: string;
  projectId: string;
  taskId?: string;
  sourceTaskId?: string;
  targetTaskId?: string;
};

export type BroadcastMessage = {
  projectId: string;
  message: ProjectBroadcastMessage;
  excludeInitiatorId?: string;
};

export type UserBroadcastMessage = {
  type: string;
  [key: string]: unknown;
};

export type UserBroadcast = {
  userId: string;
  message: UserBroadcastMessage;
  origin?: string;
};

export type NativeBroadcastMessage = {
  projectId: string;
  topics: string[];
  eventId: string;
  eventType: string;
  at: string;
  key: string;
  customerVisible: boolean;
};

export type NativeAuthorizationInvalidation = {
  type: "identity.invalidate";
  userId?: string;
  workspaceId?: string;
  projectId?: string;
};

export type BroadcastAdapter = {
  /** Publish a message to all instances watching this project */
  publish(msg: BroadcastMessage): Promise<void>;

  publishToUser(msg: UserBroadcast): Promise<void>;

  /** Subscribe to messages for delivery to local connections */
  subscribe(handler: (msg: BroadcastMessage) => void): Promise<void>;

  subscribeToUser(handler: (msg: UserBroadcast) => void): Promise<void>;

  publishNative(msg: NativeBroadcastMessage): Promise<void>;

  subscribeToNative(
    handler: (msg: NativeBroadcastMessage) => void,
  ): Promise<void>;

  publishControl(message: NativeAuthorizationInvalidation): Promise<void>;

  subscribeToControl(
    handler: (message: NativeAuthorizationInvalidation) => void,
  ): Promise<void>;

  /** Cleanup on shutdown */
  shutdown(): Promise<void>;

  /** Stop incoming delivery as soon as the server begins draining. */
  beginShutdown?(): void;

  /** Disconnect backing resources when the shared shutdown deadline expires. */
  forceShutdown?(): void;
};
