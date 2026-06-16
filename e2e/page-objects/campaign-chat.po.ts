import { expect, type Page } from "@playwright/test";

import { TIMEOUT_LONG, TIMEOUT_MEDIUM, TIMEOUT_SHORT } from "../helpers/timeouts.js";

export class CampaignChatPO {
  constructor(private readonly page: Page) {}

  // ── Locators ───────────────────────────────────────────────────────
  readonly chatMessages = this.page.getByTestId("chat-messages");
  readonly chatInput = this.page.getByLabel("Chat message");
  readonly sendButton = this.page.getByLabel("Send message");
  readonly diceInput = this.page.getByLabel("Dice notation");
  readonly rollButton = this.page.getByLabel("Roll dice");
  readonly quickDiceGroup = this.page.getByRole("group", { name: "Quick dice buttons" });

  // ── Chat ───────────────────────────────────────────────────────────

  async sendMessage(text: string): Promise<void> {
    await this.chatInput.fill(text);
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("chat.send")),
      this.sendButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async expectMessage(text: string, timeout = TIMEOUT_LONG): Promise<void> {
    await expect(this.chatMessages.getByText(text)).toBeVisible({ timeout });
  }

  /**
   * Assert the message whose content includes `text` shows `author` as its
   * author line. Scoping to the message item keeps the check unambiguous
   * when the same display name appears elsewhere in the transcript.
   */
  async expectMessageAuthor(text: string, author: string): Promise<void> {
    const message = this.chatMessages.getByTestId(/^chat-message-/).filter({ hasText: text });
    await expect(message.getByText(author)).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectChatEmpty(): Promise<void> {
    await expect(this.page.getByText(/no messages/i)).toBeVisible({ timeout: TIMEOUT_SHORT });
  }

  async expectSendDisabled(): Promise<void> {
    await expect(this.sendButton).toBeDisabled();
  }

  async expectChatInputEmpty(): Promise<void> {
    await expect(this.chatInput).toHaveValue("");
  }

  // ── Dice roller ────────────────────────────────────────────────────

  async fillDiceNotation(notation: string): Promise<void> {
    await this.diceInput.fill(notation);
  }

  async clearDiceNotation(): Promise<void> {
    await this.diceInput.fill("");
  }

  async clickQuickDie(die: string): Promise<void> {
    await this.quickDiceGroup.getByRole("button", { name: `Add 1${die}` }).click();
  }

  async clickRollDice(): Promise<void> {
    const [resp] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes("dice.roll")),
      this.rollButton.click(),
    ]);
    expect(resp.ok()).toBe(true);
  }

  async expectDiceNotation(value: string): Promise<void> {
    await expect(this.diceInput).toHaveValue(value);
  }

  async expectRollButtonDisabled(): Promise<void> {
    await expect(this.rollButton).toBeDisabled();
  }

  async expectDiceRollInChat(notation: string): Promise<void> {
    await expect(this.chatMessages.getByRole("group").filter({ hasText: notation })).toBeVisible({
      timeout: TIMEOUT_MEDIUM,
    });
  }
}
