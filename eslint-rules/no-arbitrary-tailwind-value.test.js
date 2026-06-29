// @ts-check
import { describe, it } from "vitest";

import { jsxRuleTester } from "./rule-tester.js";
import rule from "./no-arbitrary-tailwind-value.js";

const ruleTester = jsxRuleTester;

describe("no-arbitrary-tailwind-value", () => {
  it("flags Tailwind arbitrary values while allowing arbitrary selectors and properties", () => {
    ruleTester.run("no-arbitrary-tailwind-value", rule, {
      valid: [
        {
          filename: "packages/client/src/components/card.tsx",
          code: `
            export function Card() {
              return <div className="rounded bg-primary text-xs max-w-lg min-h-96" />;
            }
          `,
        },
        {
          filename: "packages/client/src/components/number-input.tsx",
          code: `
            export function NumberInput() {
              return (
                <input className="w-20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&>span]:line-clamp-1" />
              );
            }
          `,
        },
        {
          filename: "packages/client/src/components/button.tsx",
          code: `
            import { cva } from "class-variance-authority";

            export const button = cva("rounded text-sm", {
              variants: { tone: { primary: "bg-primary", muted: "bg-muted" } },
            });
          `,
        },
        {
          filename: "packages/client/src/components/data-state.tsx",
          code: 'const stateClasses = "data-[state=open]:animate-in data-[side=top]:slide-in-from-bottom-2";',
        },
        {
          filename: "packages/client/src/components/dynamic-color.tsx",
          code: "export function DynamicColor({ color }) { return <span className={`text-[${color}]`} />; }",
        },
        {
          filename: "packages/client/src/components/non-class-values.tsx",
          code: `
            const k = "error-[network]";

            export function NonClassValues() {
              return <div data-x="range-[2020-2024]" aria-label="error-[network]" />;
            }
          `,
        },
        {
          filename: "packages/client/src/components/non-class-const.tsx",
          code: `
            const errorCode = "error-[network]";

            export function NonClassConst() {
              return <div>{t(errorCode)}</div>;
            }
          `,
        },
      ],
      invalid: [
        {
          filename: "packages/client/src/components/tiny-badge.tsx",
          code: `
            export function TinyBadge() {
              return <span className="font-mono text-[10px] uppercase" />;
            }
          `,
          errors: [
            {
              messageId: "noArbitraryValue",
              data: {
                token: "text-[10px]",
                suggestion: "`text-xs` or another text scale step",
              },
            },
          ],
        },
        {
          filename: "packages/client/src/components/panel.tsx",
          code: `
            export function Panel({ active }) {
              return <div className={cn("w-[420px]", active && "max-w-[620px]")} />;
            }
          `,
          errors: [
            {
              messageId: "noArbitraryValue",
              data: {
                token: "w-[420px]",
                suggestion: "the closest width scale step, such as `w-96`",
              },
            },
            {
              messageId: "noArbitraryValue",
              data: {
                token: "max-w-[620px]",
                suggestion: "the closest max-width scale step, such as `max-w-lg`",
              },
            },
          ],
        },
        {
          filename: "packages/client/src/components/dialog.tsx",
          code: `
            import { cva } from "class-variance-authority";

            export const dialog = cva("bg-[#101820] min-h-[400px]", {
              variants: { density: { compact: "grid-cols-[1fr_auto]" } },
            });
          `,
          errors: [
            {
              messageId: "noArbitraryValue",
              data: {
                token: "bg-[#101820]",
                suggestion: "an @theme color class, such as `bg-primary` or `bg-surface`",
              },
            },
            {
              messageId: "noArbitraryValue",
              data: {
                token: "min-h-[400px]",
                suggestion: "the closest min-height scale step, such as `min-h-96`",
              },
            },
            {
              messageId: "noArbitraryValue",
              data: {
                token: "grid-cols-[1fr_auto]",
                suggestion: "a standard grid template utility or named layout token",
              },
            },
          ],
        },
        {
          filename: "packages/client/src/lib/toast.ts",
          code: 'const options = { className: "rounded-[var(--radius)] shadow-[0_0_4px_rgba(34,197,94,0.6)]" };',
          errors: [
            {
              messageId: "noArbitraryValue",
              data: {
                token: "rounded-[var(--radius)]",
                suggestion: "the radius token utility, such as `rounded`",
              },
            },
            {
              messageId: "noArbitraryValue",
              data: {
                token: "shadow-[0_0_4px_rgba(34,197,94,0.6)]",
                suggestion: "a named shadow or elevation token",
              },
            },
          ],
        },
        {
          filename: "packages/client/src/components/translucent-panel.tsx",
          code: `
            export function TranslucentPanel() {
              return <div className="bg-[#fff]/50 text-[10px]/[1.5]" />;
            }
          `,
          errors: [
            {
              messageId: "noArbitraryValue",
              data: {
                token: "bg-[#fff]/50",
                suggestion: "an @theme color class, such as `bg-primary` or `bg-surface`",
              },
            },
            {
              messageId: "noArbitraryValue",
              data: {
                token: "text-[10px]/[1.5]",
                suggestion: "`text-xs` or another text scale step",
              },
            },
          ],
        },
        {
          filename: "packages/client/src/components/important-width.tsx",
          code: `
            export function ImportantWidth() {
              return <div className="w-[10px]!" />;
            }
          `,
          errors: [
            {
              messageId: "noArbitraryValue",
              data: {
                token: "w-[10px]!",
                suggestion: "the closest width scale step, such as `w-96`",
              },
            },
          ],
        },
        {
          filename: "packages/client/src/components/glued-template.tsx",
          code: "export function GluedTemplate({ suffix }) { return <span className={`text-[10px]${suffix}`} />; }",
          errors: [
            {
              messageId: "noArbitraryValue",
              data: {
                token: "text-[10px]",
                suggestion: "`text-xs` or another text scale step",
              },
            },
          ],
        },
        {
          filename: "packages/client/src/components/mixed-template.tsx",
          code: "export function MixedTemplate({ color }) { return <span className={`text-[10px] text-[${color}]`} />; }",
          errors: [
            {
              messageId: "noArbitraryValue",
              data: {
                token: "text-[10px]",
                suggestion: "`text-xs` or another text scale step",
              },
            },
          ],
        },
        {
          filename: "packages/client/src/components/extracted-class-const.tsx",
          code: `
            const sideClass = "w-[580px] max-w-[580px]";

            export function ExtractedClassConst({ active }) {
              return <div className={cn(sideClass, active && "p-2")} />;
            }
          `,
          errors: [
            {
              messageId: "noArbitraryValue",
              data: {
                token: "w-[580px]",
                suggestion: "the closest width scale step, such as `w-96`",
              },
            },
            {
              messageId: "noArbitraryValue",
              data: {
                token: "max-w-[580px]",
                suggestion: "the closest max-width scale step, such as `max-w-lg`",
              },
            },
          ],
        },
      ],
    });
  });
});
