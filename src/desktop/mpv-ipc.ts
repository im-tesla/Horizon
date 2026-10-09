import net from "node:net";
export class MpvIpc {
  private socket?: net.Socket;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    private endpoint: string,
    private onEvent: (event: any) => void,
  ) {}
  async connect(alive: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!alive()) throw new Error("mpv exited before playback started.");
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const candidate = net.createConnection(this.endpoint);
          candidate.once("connect", () => {
            candidate.removeListener("error", reject);
            resolve(candidate);
          });
          candidate.once("error", (error) => {
            candidate.destroy();
            reject(error);
          });
        });
        this.socket = socket;
        let buffer = "";
        socket.on("data", (data) => {
          buffer += data.toString();
          let end;
          while ((end = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            try {
              const message = JSON.parse(line);
              if (
                message.request_id !== undefined &&
                this.pending.has(message.request_id)
              ) {
                const request = this.pending.get(message.request_id)!;
                this.pending.delete(message.request_id);
                clearTimeout(request.timer);
                if (message.error && message.error !== "success")
                  request.reject(new Error(`mpv: ${message.error}`));
                else request.resolve(message.data);
              } else this.onEvent(message);
            } catch {
              /* Ignore non-JSON diagnostic lines. */
            }
          }
        });
        socket.on("error", () => this.rejectAll());
        socket.on("close", () => this.rejectAll());
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
    throw new Error("Could not connect to the mpv playback engine.");
  }
  command(command: unknown[]): Promise<any> {
    if (!this.socket || this.socket.destroyed)
      return Promise.reject(new Error("Playback is not running."));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Playback command timed out."));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(`${JSON.stringify({ command, request_id: id })}\n`);
    });
  }
  private rejectAll(): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Playback connection closed."));
    }
    this.pending.clear();
  }
  close(): void {
    this.rejectAll();
    this.socket?.destroy();
  }
}
