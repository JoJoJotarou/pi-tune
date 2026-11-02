const NOTIFY_THRESHOLD_MS = 15_000;

export interface NotificationEnv {
  KITTY_WINDOW_ID?: string;
}

/** Notify only for a finished run that lasted long enough and was not interrupted. */
export function shouldNotify(elapsedMs: number, aborted: boolean): boolean {
  return !aborted && elapsedMs >= NOTIFY_THRESHOLD_MS;
}

/** Terminal notification escape sequence: OSC 99 under Kitty, OSC 777 elsewhere. */
export function notificationSequence(title: string, body: string, env: NotificationEnv): string {
  if (env.KITTY_WINDOW_ID) {
    return `\x1b]99;i=1:d=0;${title}\x1b\\` + `\x1b]99;i=1:p=body;${body}\x1b\\`;
  }
  return `\x1b]777;notify;${title};${body}\x07`;
}
