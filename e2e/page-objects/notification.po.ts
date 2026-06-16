import { expect, type Page } from "@playwright/test";

import { TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";

export class NotificationPO {
  constructor(private readonly page: Page) {}

  // ── Named locators ─────────────────────────────────────────────────

  readonly bellButton = this.page.getByRole("button", { name: /^Notifications/ });
  readonly markAllReadButton = this.page.getByRole("button", { name: "Mark all read" });
  readonly notificationList = this.page.getByRole("list");

  // ── Actions ────────────────────────────────────────────────────────

  async clickBell(): Promise<void> {
    await this.bellButton.click();
  }

  async clickMarkAllRead(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("notification.markAllRead")),
      this.markAllReadButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async clickNotification(title: string): Promise<void> {
    await this.notificationList.getByRole("button", { name: title }).click();
  }

  // ── Assertions ─────────────────────────────────────────────────────

  async expectUnreadCount(count: number): Promise<void> {
    if (count === 0) {
      await expect(this.page.getByLabel("Notifications", { exact: true })).toBeVisible({
        timeout: TIMEOUT_MEDIUM,
      });
    } else {
      await expect(this.page.getByLabel(`Notifications (${String(count)} unread)`)).toBeVisible({
        timeout: TIMEOUT_MEDIUM,
      });
    }
  }

  async expectPopoverOpen(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  }

  async expectNotificationVisible(text: string): Promise<void> {
    await expect(this.notificationList.getByText(text)).toBeVisible({ timeout: TIMEOUT_MEDIUM });
  }

  async expectEmpty(): Promise<void> {
    await expect(this.page.getByText("No notifications yet")).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectMarkAllReadHidden(): Promise<void> {
    await expect(this.markAllReadButton).toBeHidden();
  }

  async expectUnreadDot(): Promise<void> {
    // exact: true keeps the bell ("Notifications (N unread)") out of the match.
    await expect(this.page.getByLabel("Unread", { exact: true })).toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }

  async expectNoUnreadDots(): Promise<void> {
    await expect(this.page.getByLabel("Unread", { exact: true })).not.toBeVisible({
      timeout: TIMEOUT_SHORT,
    });
  }
}
