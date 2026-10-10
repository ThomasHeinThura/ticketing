import type {
  BroadcastAdapter,
  BroadcastMessage,
  ControlMessage,
  NativeBroadcastMessage,
  UserBroadcast,
} from "./broadcast-adapter";

export class InMemoryBroadcastAdapter implements BroadcastAdapter {
  private handler?: (msg: BroadcastMessage) => void;
  private userHandler?: (msg: UserBroadcast) => void;
  private nativeHandler?: (msg: NativeBroadcastMessage) => void;
  private controlHandler?: (msg: ControlMessage) => void;

  async publish(msg: BroadcastMessage): Promise<void> {
    // Deliver directly in the same process
    this.handler?.(msg);
  }

  async publishToUser(msg: UserBroadcast): Promise<void> {
    this.userHandler?.(msg);
  }

  async subscribe(handler: (msg: BroadcastMessage) => void): Promise<void> {
    this.handler = handler;
  }

  async subscribeToUser(handler: (msg: UserBroadcast) => void): Promise<void> {
    this.userHandler = handler;
  }

  async publishNative(msg: NativeBroadcastMessage): Promise<void> {
    this.nativeHandler?.(msg);
  }

  async subscribeToNative(
    handler: (msg: NativeBroadcastMessage) => void,
  ): Promise<void> {
    this.nativeHandler = handler;
  }

  async publishControl(message: ControlMessage): Promise<void> {
    this.controlHandler?.(message);
  }

  async subscribeToControl(
    handler: (message: ControlMessage) => void,
  ): Promise<void> {
    this.controlHandler = handler;
  }

  async shutdown(): Promise<void> {
    this.handler = undefined;
    this.userHandler = undefined;
    this.nativeHandler = undefined;
    this.controlHandler = undefined;
  }
}
