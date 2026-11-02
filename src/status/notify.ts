import { execFile } from "node:child_process";

const NOTIFY_THRESHOLD_MS = 15_000;

export interface NotificationEnv {
  KITTY_WINDOW_ID?: string;
  TERM_PROGRAM?: string;
}

/** Process boundary, injected in tests. */
export type NotificationRunner = (command: string, args: string[]) => void | Promise<void>;

export type NotificationDelivery =
  | { kind: "sequence"; sequence: string }
  | { kind: "command"; command: string; args: string[] };

export interface SendOptions {
  env: NotificationEnv;
  platform: string;
  /** Defaults to stdout. */
  write?: (text: string) => void;
  /** Defaults to `execFile` without a shell. */
  run?: NotificationRunner;
}

/** Notify only for a finished run that lasted long enough and was not interrupted. */
export function shouldNotify(elapsedMs: number, aborted: boolean): boolean {
  return !aborted && elapsedMs >= NOTIFY_THRESHOLD_MS;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * OSC 99 under Kitty, OSC 777 elsewhere, except on macOS terminals that do not pass OSC through
 * (Zed, VS Code, or no `TERM_PROGRAM`): there a Notification Center banner is the only way through.
 */
export function notificationDelivery(
  title: string,
  body: string,
  env: NotificationEnv,
  platform: string,
): NotificationDelivery {
  if (env.KITTY_WINDOW_ID) {
    return {
      kind: "sequence",
      sequence: `\x1b]99;i=1:d=0;${title}\x1b\\` + `\x1b]99;i=1:p=body;${body}\x1b\\`,
    };
  }
  const termProgram = env.TERM_PROGRAM ?? "";
  const macFallback =
    platform === "darwin" && (termProgram === "" || termProgram === "zed" || termProgram === "vscode");
  if (macFallback) {
    return {
      kind: "command",
      command: "osascript",
      args: ["-e", `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`],
    };
  }
  return { kind: "sequence", sequence: `\x1b]777;notify;${title};${body}\x07` };
}

function runExecFile(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => (error ? reject(error) : resolve()));
  });
}

export async function sendNotification(title: string, body: string, options: SendOptions): Promise<void> {
  const delivery = notificationDelivery(title, body, options.env, options.platform);
  if (delivery.kind === "sequence") {
    const write = options.write ?? ((text: string) => void process.stdout.write(text));
    write(delivery.sequence);
    return;
  }
  await (options.run ?? runExecFile)(delivery.command, delivery.args);
}
