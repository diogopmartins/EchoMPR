import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { metricInfo } from '../utils/metricInfo';

/**
 * Hover (or keyboard focus, or tap) explanation of a number or label: what it
 * is, how it is measured, typical values and the source. The text comes from
 * utils/metricInfo by id, or from `info`; `extra` adds a line about the value
 * on screen. The bubble is portalled to <body> and kept inside the window.
 */

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 180;
const GAP_PX = 6;
const MARGIN_PX = 8;

const Trigger = styled.span`
  cursor: help;
  text-decoration: underline dotted rgba(255, 255, 255, 0.38);
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  border-radius: 2px;
  outline: none;

  &:focus-visible {
    outline: 1px solid #4fc3f7;
    outline-offset: 1px;
  }
`;

const Bubble = styled.div`
  position: fixed;
  z-index: 10000;
  width: max-content;
  max-width: min(300px, calc(100vw - 32px));
  background: #121212;
  border: 1px solid #5a5a5a;
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
  padding: 0.45rem 0.55rem;
  font: 400 0.72rem/1.45 Arial, Helvetica, sans-serif;
  color: #e0e0e0;
  text-transform: none;
  letter-spacing: 0;
  text-align: left;
  white-space: normal;
  pointer-events: auto;

  strong {
    display: block;
    color: #fff;
    margin-bottom: 0.15rem;
  }
  div + div {
    margin-top: 0.3rem;
  }
  .extra {
    color: #ffcc80;
  }
  .normal {
    color: #a5d6a7;
  }
  .source a {
    color: #81d4fa;
  }
`;

export default function Tip({ id, ctx, info: infoProp, extra, children }) {
  const info = infoProp || (id ? metricInfo(id, ctx) : null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const bubbleRef = useRef(null);
  const timer = useRef(null);
  const bubbleId = useId();

  const schedule = (fn, ms) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  // Place the bubble below the trigger (above when there is no room), inside the window.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !bubbleRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const b = bubbleRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = r.bottom + GAP_PX;
    if (top + b.height > vh - MARGIN_PX && r.top - GAP_PX - b.height >= MARGIN_PX) top = r.top - GAP_PX - b.height;
    top = Math.max(MARGIN_PX, Math.min(top, vh - MARGIN_PX - b.height));
    const left = Math.max(MARGIN_PX, Math.min(r.left, vw - MARGIN_PX - b.width));
    setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
  }, [open, info, extra]);

  // Close on Escape, and when anything scrolls (the bubble is fixed).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && hide();
    const onScroll = (e) => {
      if (bubbleRef.current && bubbleRef.current.contains(e.target)) return;
      hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  if (!info) return children ?? null;

  return (
    <>
      <Trigger
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? bubbleId : undefined}
        data-tip={id || info.title}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') schedule(show, OPEN_DELAY_MS);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') schedule(hide, CLOSE_DELAY_MS);
        }}
        onFocus={show}
        onBlur={(e) => {
          if (bubbleRef.current && bubbleRef.current.contains(e.relatedTarget)) return;
          schedule(hide, CLOSE_DELAY_MS);
        }}
      >
        {children}
      </Trigger>
      {open
        ? createPortal(
            <Bubble
              ref={bubbleRef}
              id={bubbleId}
              role="tooltip"
              style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
              onPointerEnter={() => clearTimeout(timer.current)}
              onPointerLeave={() => schedule(hide, CLOSE_DELAY_MS)}
              onClick={(e) => e.stopPropagation()}
            >
              <strong>{info.title}</strong>
              <div>{info.text}</div>
              {extra ? <div className="extra">{extra}</div> : null}
              {info.normal ? <div className="normal">{info.normal}</div> : null}
              {info.source ? (
                <div className="source">
                  Source:{' '}
                  <a href={info.source.url} target="_blank" rel="noopener noreferrer">
                    {info.source.label}
                  </a>
                </div>
              ) : null}
            </Bubble>,
            document.body
          )
        : null}
    </>
  );
}
