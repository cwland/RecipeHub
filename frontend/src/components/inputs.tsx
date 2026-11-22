import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

// Text that looks like plain text until you click it. Saves on blur or Enter.
interface InlineTextProps {
  value: string;
  onSave: (value: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  allowEmpty?: boolean;
  onChangeText?: (value: string) => void;
  onEscape?: () => void;
  size?: number;
}

export const InlineText = forwardRef<HTMLInputElement, InlineTextProps>(function InlineText(
  { value, onSave, onEnter, placeholder, className = "", autoFocus, ariaLabel, allowEmpty, onChangeText, onEscape, size },
  ref
) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  function commit() {
    const trimmed = text.trim();
    if (!trimmed && !allowEmpty) return setText(value);
    if (trimmed !== value) onSave(trimmed);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      onEnter ? onEnter() : e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setText(value);
      onEscape?.();
      e.currentTarget.blur();
    }
  }

  return (
    <input
      ref={ref}
      value={text}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoFocus={autoFocus}
      size={size}
      onChange={(e) => {
        setText(e.target.value);
        onChangeText?.(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={`min-w-0 rounded border border-transparent bg-transparent px-1 py-1 outline-none hover:border-strong focus:border-action focus:bg-container focus:ring-2 focus:ring-action/15 ${className}`}
    />
  );
});
