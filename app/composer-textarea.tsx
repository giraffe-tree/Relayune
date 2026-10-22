"use client";

import { useLayoutEffect, type RefObject, type TextareaHTMLAttributes } from "react";

export function ComposerTextarea({ inputRef, value, ...props }:
  TextareaHTMLAttributes<HTMLTextAreaElement> & { inputRef: RefObject<HTMLTextAreaElement | null> }) {
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let width = input.clientWidth;
    const resize = () => {
      const maximum = Math.max(62, Math.min(220, window.innerHeight * 0.28));
      input.style.height = "0px";
      const height = Math.max(62, Math.min(input.scrollHeight, maximum));
      input.style.height = `${height}px`;
      input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden";
    };
    resize();
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      resize();
    });
    observer.observe(input);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [inputRef, value]);

  return <textarea {...props} ref={inputRef} value={value} />;
}
