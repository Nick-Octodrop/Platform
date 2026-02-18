import React, { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default function DaisyTooltip({ label, placement = "bottom", className = "", children }) {
  const triggerRef = useRef(null);
  const tipRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: -9999, left: -9999, ready: false, place: placement });

  useLayoutEffect(() => {
    if (!open || !label) return;

    function update() {
      const trigger = triggerRef.current;
      const tip = tipRef.current;
      if (!trigger || !tip) return;
      const tr = trigger.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      const margin = 8;
      const canPlaceBottom = tr.bottom + margin + tipRect.height <= window.innerHeight - 4;
      const canPlaceTop = tr.top - margin - tipRect.height >= 4;
      let place = placement;
      if (placement === "bottom" && !canPlaceBottom && canPlaceTop) place = "top";
      if (placement === "top" && !canPlaceTop && canPlaceBottom) place = "bottom";

      const top = place === "top" ? tr.top - tipRect.height - margin : tr.bottom + margin;
      const centeredLeft = tr.left + tr.width / 2 - tipRect.width / 2;
      const left = clamp(centeredLeft, 6, window.innerWidth - tipRect.width - 6);
      setCoords({ top, left, ready: true, place });
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, label, placement]);

  useEffect(() => {
    if (!open) setCoords((prev) => ({ ...prev, ready: false }));
  }, [open]);

  function mergeHandlers(original, next) {
    return (...args) => {
      if (typeof original === "function") original(...args);
      next(...args);
    };
  }

  function setTriggerNode(node) {
    triggerRef.current = node;
  }

  const childNode = isValidElement(children)
    ? cloneElement(children, {
        className: [children.props?.className, className].filter(Boolean).join(" "),
        ref: setTriggerNode,
        onMouseEnter: mergeHandlers(children.props?.onMouseEnter, () => setOpen(true)),
        onMouseLeave: mergeHandlers(children.props?.onMouseLeave, () => setOpen(false)),
        onFocus: mergeHandlers(children.props?.onFocus, () => setOpen(true)),
        onBlur: mergeHandlers(children.props?.onBlur, () => setOpen(false)),
      })
    : (
      <span
        ref={setTriggerNode}
        className={className}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
    );

  return (
    <>
      {childNode}
      {open && label
        ? createPortal(
            <span
              ref={tipRef}
              className="pointer-events-none fixed z-[2147483647] max-w-[24rem] break-words rounded-md bg-neutral px-2 py-1 text-xs text-neutral-content shadow-lg"
              style={{
                top: coords.top,
                left: coords.left,
                visibility: coords.ready ? "visible" : "hidden",
              }}
              role="tooltip"
              data-placement={coords.place}
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </>
  );
}
