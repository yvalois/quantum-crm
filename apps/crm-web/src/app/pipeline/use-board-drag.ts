"use client";

import type { Opportunity, PipelineStage } from "@quantum-crm/contracts";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";

interface PointerMove {
  readonly opportunity: Opportunity;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
  active: boolean;
}

export function useBoardDrag({
  boardRef,
  disabled,
  onMove,
  stages,
}: {
  readonly boardRef: RefObject<HTMLElement | null>;
  readonly disabled: boolean;
  readonly onMove: (opportunity: Opportunity, stageId: string) => Promise<void>;
  readonly stages: readonly PipelineStage[];
}) {
  const [opportunityId, setOpportunityId] = useState<string | null>(null);
  const [targetStageId, setTargetStageId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pointer = useRef<PointerMove | null>(null);
  const keyboardOpportunity = useRef<Opportunity | null>(null);
  const target = useRef<string | null>(null);
  const suppressedClick = useRef(false);

  function updateTarget(stageId: string | null): void {
    if (target.current === stageId) return;
    target.current = stageId;
    setTargetStageId(stageId);
    const stage = stages.find((item) => item.id === stageId);
    if (stage) setAnnouncement(`Destino: ${stage.name}. Suelta para mover.`);
  }

  function targetAt(x: number, y: number): string | null {
    const column = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-stage-id]");
    return column && boardRef.current?.contains(column) ? (column.dataset.stageId ?? null) : null;
  }

  function cancel(): void {
    pointer.current = null;
    keyboardOpportunity.current = null;
    target.current = null;
    setOpportunityId(null);
    setTargetStageId(null);
  }

  useEffect(() => {
    if (!opportunityId) return;
    let frame = 0;
    const scroll = (): void => {
      const current = pointer.current;
      const board = boardRef.current;
      if (current?.active && board) {
        const bounds = board.getBoundingClientRect();
        const horizontal =
          current.x < bounds.left + 64 ? -16 : current.x > bounds.right - 64 ? 16 : 0;
        const column = document
          .elementFromPoint(current.x, current.y)
          ?.closest<HTMLElement>("[data-stage-id]");
        const stack = column?.querySelector<HTMLElement>("[data-card-stack]");
        const stackBounds = stack?.getBoundingClientRect();
        const vertical = stackBounds
          ? current.y < stackBounds.top + 48
            ? -12
            : current.y > stackBounds.bottom - 48
              ? 12
              : 0
          : 0;
        if (horizontal || vertical) {
          board.scrollBy(horizontal, 0);
          stack?.scrollBy(0, vertical);
          const targetColumn = document
            .elementFromPoint(current.x, current.y)
            ?.closest<HTMLElement>("[data-stage-id]");
          const stageId =
            targetColumn && board.contains(targetColumn)
              ? (targetColumn.dataset.stageId ?? null)
              : null;
          if (stageId !== target.current) {
            target.current = stageId;
            setTargetStageId(stageId);
          }
        }
      }
      frame = window.requestAnimationFrame(scroll);
    };
    frame = window.requestAnimationFrame(scroll);
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
      setAnnouncement("Movimiento cancelado.");
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
    };
  }, [boardRef, opportunityId]);

  function onPointerDown(event: PointerEvent<HTMLElement>, opportunity: Opportunity): void {
    suppressedClick.current = false;
    if (disabled || opportunity.status !== "OPEN" || event.button !== 0 || !event.isPrimary) return;
    const element = event.target instanceof Element ? event.target : null;
    const handle = element?.closest("[data-drag-handle]");
    if (event.pointerType !== "mouse" && !handle) return;
    if (
      element?.closest(
        "a, input, select, textarea, button:not([data-card-open]):not([data-drag-handle])",
      )
    )
      return;
    pointer.current = {
      opportunity,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    const current = pointer.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX;
    current.y = event.clientY;
    if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) < 7)
      return;
    if (!current.active) {
      current.active = true;
      suppressedClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setOpportunityId(current.opportunity.id);
      setAnnouncement(`Moviendo ${current.opportunity.title}. Elige una etapa.`);
    }
    event.preventDefault();
    updateTarget(targetAt(current.x, current.y));
  }

  function onPointerUp(event: PointerEvent<HTMLElement>): void {
    const current = pointer.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const stageId = current.active ? targetAt(event.clientX, event.clientY) : null;
    cancel();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (stageId && stageId !== current.opportunity.stageId)
      void onMove(current.opportunity, stageId);
  }

  function onHandleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    opportunity: Opportunity,
  ): void {
    if (disabled || opportunity.status !== "OPEN") return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (keyboardOpportunity.current?.id === opportunity.id) {
        const stageId = target.current;
        cancel();
        if (stageId && stageId !== opportunity.stageId) void onMove(opportunity, stageId);
      } else {
        keyboardOpportunity.current = opportunity;
        setOpportunityId(opportunity.id);
        updateTarget(opportunity.stageId);
        setAnnouncement(
          `Moviendo ${opportunity.title}. Usa las flechas para elegir etapa y Enter para confirmar.`,
        );
      }
      return;
    }
    if (
      !keyboardOpportunity.current ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const index = stages.findIndex((stage) => stage.id === target.current);
    const stage = stages[Math.max(0, Math.min(stages.length - 1, index + direction))];
    if (!stage) return;
    updateTarget(stage.id);
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-stage-id="${stage.id}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    setAnnouncement(`Destino: ${stage.name}. Enter para confirmar; Escape para cancelar.`);
  }

  return {
    announcement,
    cancel,
    onHandleKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    opportunityId,
    targetStageId,
    suppressClick: (): boolean => {
      const suppressed = suppressedClick.current;
      suppressedClick.current = false;
      return suppressed;
    },
  };
}
