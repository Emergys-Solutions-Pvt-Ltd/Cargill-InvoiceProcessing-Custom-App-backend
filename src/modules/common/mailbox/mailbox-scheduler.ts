import { errorMessage } from '../integrations/engine/core/errors.js';
import type { Logger } from '../integrations/engine/core/logger.js';

/**
 * Runs the mailbox poller every intervalMs. Polls never overlap: a tick that comes while the
 * previous poll is still running is skipped. stop() waits for a running poll to finish.
 */
export interface MailboxSchedulerOptions {
  intervalMs: number;
}

export interface MailboxSchedulerDependencies {
  poll: () => Promise<void>;
  logger: Logger;
}

export class MailboxScheduler {
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;

  constructor(
    private readonly deps: MailboxSchedulerDependencies,
    private readonly options: MailboxSchedulerOptions,
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    this.timer.unref?.();
    void this.tick();
    this.deps.logger.info('Mailbox polling started', { intervalMs: this.options.intervalMs });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.polling;
  }

  /** One poll unless one is already running; public for tests. */
  tick(): Promise<void> {
    if (this.polling) return this.polling;
    this.polling = this.deps
      .poll()
      .catch((err) => this.deps.logger.error('Mailbox poll failed', { error: errorMessage(err) }))
      .finally(() => {
        this.polling = null;
      });
    return this.polling;
  }
}
