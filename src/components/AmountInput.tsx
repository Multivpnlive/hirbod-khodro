import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { toEnglishDigits } from "@/lib/feature-utils";

type AmountInputProps = Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange" | "type"> & {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
};

function digits(value: string | number | undefined): string {
  return toEnglishDigits(String(value ?? "")).replace(/\D/g, "");
}

function grouped(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function caretAfterDigits(value: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (/\d/.test(value[i]!)) seen += 1;
    if (seen === count) return i + 1;
  }
  return value.length;
}

/** Displays grouped Latin digits while keeping form values parseable as numbers. */
export function AmountInput({ value, defaultValue, onValueChange, name, ...props }: AmountInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const controlled = value !== undefined;
  const initial = digits(defaultValue);
  const [uncontrolledValue, setUncontrolledValue] = useState(initial);
  const raw = controlled ? digits(value) : uncontrolledValue;

  useEffect(() => {
    if (controlled) return;
    const form = inputRef.current?.form;
    if (!form) return;
    const reset = () => setUncontrolledValue(initial);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [controlled, initial]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const digitsBeforeCaret = digits(input.value.slice(0, input.selectionStart ?? input.value.length)).length;
    const next = digits(input.value);
    const nextDisplay = grouped(next);
    if (!controlled) setUncontrolledValue(next);
    onValueChange?.(next);
    requestAnimationFrame(() => {
      if (inputRef.current === input) {
        const caret = caretAfterDigits(nextDisplay, digitsBeforeCaret);
        input.setSelectionRange(caret, caret);
      }
    });
  }

  return (
    <Input
      {...props}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      dir="ltr"
      className={`text-left tabular-nums ${props.className ?? ""}`}
      name={name}
      value={grouped(raw)}
      onChange={handleChange}
      autoComplete={props.autoComplete ?? "off"}
    />
  );
}
