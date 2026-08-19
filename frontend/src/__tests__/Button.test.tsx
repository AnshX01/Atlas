import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { Button } from "../components/ui/Button";

describe("Button component", () => {
  it("should have aria-busy and aria-disabled when isLoading is true", () => {
    const { getByRole } = render(<Button isLoading>Click Me</Button>);
    const btn = getByRole("button");
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("should have default type of button", () => {
    const { getByRole } = render(<Button>Click Me</Button>);
    const btn = getByRole("button");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("should not block rapid clicks globally (debounce anti-pattern)", () => {
    const onClick = jest.fn();
    const { getByRole } = render(<Button onClick={onClick}>Click</Button>);
    const btn = getByRole("button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
