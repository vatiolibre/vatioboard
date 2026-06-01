const DEFAULT_DRAG_THRESHOLD_PX = 6;
const TOUCH_MOVE_OPTIONS = { capture: true, passive: false };
const CAPTURE_OPTIONS = { capture: true };

type AnyRecord = Record<string, any>;

export interface DragPoint {
  clientX: number;
  clientY: number;
  x: number;
  y: number;
}

export interface DragPayload {
  type: "start" | "move" | "end" | "cancel";
  event: Event;
  context: unknown;
  pointerType: string;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  dx: number;
  dy: number;
  movementX: number;
  movementY: number;
  point: DragPoint;
  canceled?: boolean;
}

export interface DragSensorOptions {
  source: HTMLElement;
  canStart?: (event: Event, point: DragPoint) => unknown;
  onStart?: (payload: DragPayload) => void;
  onMove?: (payload: DragPayload) => void;
  onEnd?: (payload: DragPayload) => void;
  onCancel?: (payload: Partial<DragPayload> & { context?: unknown; event?: Event; pointerType?: string; canceled?: boolean }) => void;
  preventDefaultOnStart?: boolean;
  thresholdPx?: number;
}

export interface DragSensorController {
  cancel(): void;
  destroy(): void;
}

function makePoint(clientX: number, clientY: number): DragPoint {
  return { clientX, clientY, x: clientX, y: clientY };
}

function pointFromPointerEvent(event: AnyRecord, fallback: DragPoint | null = null): DragPoint | null {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return makePoint(x, y);
}

function pointFromTouch(touch: AnyRecord | null | undefined, fallback: DragPoint | null = null): DragPoint | null {
  if (!touch) return fallback;
  const x = Number(touch.clientX);
  const y = Number(touch.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return makePoint(x, y);
}

function findTouch(event: AnyRecord, identifier: number) {
  const touches: AnyRecord[] = [
    ...Array.from(event?.changedTouches || []),
    ...Array.from(event?.touches || []),
  ];
  return touches.find((touch) => touch.identifier === identifier) || null;
}

function distanceBetween(a: DragPoint | null, b: DragPoint | null) {
  if (!a || !b) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function buildDragPayload(sensor: AnyRecord, point: DragPoint, event: Event, type: DragPayload["type"]): DragPayload {
  const dx = point.clientX - sensor.startPoint.clientX;
  const dy = point.clientY - sensor.startPoint.clientY;
  const movementX = point.clientX - sensor.lastPoint.clientX;
  const movementY = point.clientY - sensor.lastPoint.clientY;
  return {
    type,
    event,
    context: sensor.context,
    pointerType: sensor.pointerType,
    startX: sensor.startPoint.clientX,
    startY: sensor.startPoint.clientY,
    clientX: point.clientX,
    clientY: point.clientY,
    dx,
    dy,
    movementX,
    movementY,
    point,
  };
}

function createTouchDragSensor({
  source,
  canStart,
  onStart,
  onMove,
  onEnd,
  onCancel,
  preventDefaultOnStart = false,
  thresholdPx = DEFAULT_DRAG_THRESHOLD_PX,
}: DragSensorOptions): DragSensorController {
  let active: AnyRecord | null = null;

  function cleanup() {
    document.removeEventListener("touchmove", handleMove, TOUCH_MOVE_OPTIONS);
    document.removeEventListener("touchend", handleEnd, TOUCH_MOVE_OPTIONS);
    document.removeEventListener("touchcancel", handleCancel, TOUCH_MOVE_OPTIONS);
    window.removeEventListener("blur", handleHardCancel, CAPTURE_OPTIONS);
    document.removeEventListener("visibilitychange", handleVisibilityChange, CAPTURE_OPTIONS);
    active = null;
  }

  function finish(event: Event, canceled = false) {
    const sensor = active;
    if (!sensor) return;
    cleanup();
    if (!sensor.started) {
      onCancel?.({ context: sensor.context, event, pointerType: sensor.pointerType });
      return;
    }
    const payload = buildDragPayload(sensor, sensor.lastPoint, event, canceled ? "cancel" : "end");
    if (canceled) {
      onEnd?.({ ...payload, canceled: true });
    } else {
      onEnd?.(payload);
    }
  }

  function handleStart(event: TouchEvent) {
    if (active || event.touches?.length > 1) return;
    const touch = event.changedTouches?.[0] || event.touches?.[0];
    const point = pointFromTouch(touch);
    if (!touch || !point) return;
    const context = canStart?.(event, point);
    if (!context) return;

    active = {
      context,
      identifier: touch.identifier,
      pointerType: "touch",
      startPoint: point,
      lastPoint: point,
      started: false,
    };

    document.addEventListener("touchmove", handleMove, TOUCH_MOVE_OPTIONS);
    document.addEventListener("touchend", handleEnd, TOUCH_MOVE_OPTIONS);
    document.addEventListener("touchcancel", handleCancel, TOUCH_MOVE_OPTIONS);
    window.addEventListener("blur", handleHardCancel, CAPTURE_OPTIONS);
    document.addEventListener("visibilitychange", handleVisibilityChange, CAPTURE_OPTIONS);
    if (preventDefaultOnStart) event.preventDefault?.();
  }

  function handleMove(event: TouchEvent) {
    const sensor = active;
    if (!sensor) return;
    const touch = findTouch(event, sensor.identifier);
    const point = pointFromTouch(touch, sensor.lastPoint);
    if (!point) return;
    event.preventDefault?.();

    if (!sensor.started) {
      if (distanceBetween(sensor.startPoint, point) < thresholdPx) {
        sensor.lastPoint = point;
        return;
      }
      sensor.started = true;
      onStart?.(buildDragPayload(sensor, point, event, "start"));
    }

    onMove?.(buildDragPayload(sensor, point, event, "move"));
    sensor.lastPoint = point;
  }

  function handleEnd(event: TouchEvent) {
    const sensor = active;
    if (!sensor) return;
    const touch = findTouch(event, sensor.identifier);
    const point = pointFromTouch(touch, sensor.lastPoint);
    sensor.lastPoint = point;
    if (sensor.started) event.preventDefault?.();
    finish(event, false);
  }

  function handleCancel(event: Event) {
    const sensor = active;
    if (!sensor) return;
    const touch = findTouch(event, sensor.identifier);
    sensor.lastPoint = pointFromTouch(touch, sensor.lastPoint);
    if (sensor.started) event.preventDefault?.();
    finish(event, true);
  }

  function handleHardCancel(event: Event) {
    finish(event, true);
  }

  function handleVisibilityChange(event: Event) {
    if (document.visibilityState === "hidden") finish(event, true);
  }

  source.addEventListener("touchstart", handleStart, { passive: false });
  return {
    destroy() {
      cleanup();
      source.removeEventListener("touchstart", handleStart);
    },
    cancel: cleanup,
  };
}

function createPointerDragSensor({
  source,
  canStart,
  onStart,
  onMove,
  onEnd,
  onCancel,
  thresholdPx = DEFAULT_DRAG_THRESHOLD_PX,
}: DragSensorOptions): DragSensorController {
  let active: AnyRecord | null = null;

  function cleanup() {
    window.removeEventListener("pointermove", handleMove, TOUCH_MOVE_OPTIONS);
    window.removeEventListener("pointerup", handleEnd, CAPTURE_OPTIONS);
    window.removeEventListener("pointercancel", handleCancel, CAPTURE_OPTIONS);
    source.removeEventListener("lostpointercapture", handleCancel, CAPTURE_OPTIONS);
    active = null;
  }

  function finish(event: PointerEvent, canceled = false) {
    const sensor = active;
    if (!sensor) return;
    cleanup();
    if (!sensor.started) {
      onCancel?.({ context: sensor.context, event, pointerType: sensor.pointerType });
      return;
    }
    const point = pointFromPointerEvent(event, sensor.lastPoint);
    sensor.lastPoint = point;
    const payload = buildDragPayload(sensor, point, event, canceled ? "cancel" : "end");
    if (canceled) {
      onCancel?.({ ...payload, canceled: true });
    } else {
      onEnd?.(payload);
    }
  }

  function handleStart(event: PointerEvent) {
    if (active || event.pointerType === "touch") return;
    if (event.button !== undefined && event.button !== 0) return;
    const point = pointFromPointerEvent(event);
    if (!point) return;
    const context = canStart?.(event, point);
    if (!context) return;

    active = {
      context,
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      startPoint: point,
      lastPoint: point,
      started: false,
    };

    window.addEventListener("pointermove", handleMove, TOUCH_MOVE_OPTIONS);
    window.addEventListener("pointerup", handleEnd, CAPTURE_OPTIONS);
    window.addEventListener("pointercancel", handleCancel, CAPTURE_OPTIONS);
    source.addEventListener("lostpointercapture", handleCancel, CAPTURE_OPTIONS);
    try {
      source.setPointerCapture?.(event.pointerId);
    } catch {
      // best effort for mouse/pen only
    }
  }

  function handleMove(event: PointerEvent) {
    const sensor = active;
    if (!sensor) return;
    if (sensor.pointerId != null && event.pointerId != null && event.pointerId !== sensor.pointerId) return;
    const point = pointFromPointerEvent(event, sensor.lastPoint);
    if (!point) return;

    if (!sensor.started) {
      if (distanceBetween(sensor.startPoint, point) < thresholdPx) {
        sensor.lastPoint = point;
        return;
      }
      sensor.started = true;
      onStart?.(buildDragPayload(sensor, point, event, "start"));
    }

    onMove?.(buildDragPayload(sensor, point, event, "move"));
    sensor.lastPoint = point;
    event.preventDefault?.();
  }

  function handleEnd(event: PointerEvent) {
    const sensor = active;
    if (!sensor) return;
    if (sensor.pointerId != null && event.pointerId != null && event.pointerId !== sensor.pointerId) return;
    try {
      source.releasePointerCapture?.(sensor.pointerId);
    } catch {
      // ignore
    }
    finish(event, false);
  }

  function handleCancel(event: PointerEvent) {
    const sensor = active;
    if (!sensor) return;
    if (sensor.pointerId != null && event.pointerId != null && event.pointerId !== sensor.pointerId) return;
    try {
      source.releasePointerCapture?.(sensor.pointerId);
    } catch {
      // ignore
    }
    finish(event, true);
  }

  source.addEventListener("pointerdown", handleStart);
  return {
    destroy() {
      cleanup();
      source.removeEventListener("pointerdown", handleStart);
    },
    cancel: cleanup,
  };
}

export function createDragSensors(options: DragSensorOptions): DragSensorController {
  const touchSensor = createTouchDragSensor(options);
  const pointerSensor = createPointerDragSensor(options);
  return {
    destroy() {
      touchSensor.destroy();
      pointerSensor.destroy();
    },
    cancel() {
      touchSensor.cancel();
      pointerSensor.cancel();
    },
  };
}
