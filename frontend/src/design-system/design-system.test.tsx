import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Alert } from "./Alert";
import { Button } from "./Button";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { TextField } from "./TextField";
import { palette, status } from "./tokens";

describe("Button", () => {
  it("is disabled and busy while loading", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});

describe("TextField", () => {
  it("links the error message to the input for screen readers", () => {
    render(<TextField label="Email" error="Enter a valid email address." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email address.");
  });
});

describe("Alert", () => {
  it("announces errors with role=alert and others with role=status", () => {
    const { rerender } = render(<Alert tone="error" title="Failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    rerender(<Alert tone="info" title="Note" />);
    expect(screen.getByRole("status")).toHaveTextContent("Note");
  });
});

describe("ConfidenceBadge", () => {
  it.each([
    ["simulated", "Simulated"],
    ["scheduled", "Scheduled"],
    ["estimated", "Estimated"],
    ["verified", "Verified live"],
  ] as const)("labels %s data in words, not colour alone", (level, label) => {
    render(<ConfidenceBadge level={level} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows the snapshot date when given", () => {
    render(<ConfidenceBadge level="scheduled" asOf="12 Nov 2026" />);
    expect(screen.getByText(/as of 12 Nov 2026/)).toBeInTheDocument();
  });
});

describe("design tokens", () => {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8").toLowerCase();

  it("keeps the approved palette identical in CSS and TypeScript", () => {
    for (const hex of Object.values(palette)) expect(css).toContain(hex.toLowerCase());
    for (const { fg, tint } of Object.values(status)) {
      expect(css).toContain(fg.toLowerCase());
      expect(css).toContain(tint.toLowerCase());
    }
  });
});
