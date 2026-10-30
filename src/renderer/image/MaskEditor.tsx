/**
 * 遮罩（涂抹区域）编辑：本地画一张与参考图同尺寸的 PNG，
 * 涂过的地方是白色不透明、其余透明 —— 这正是 OpenAI `images/edits` 的 mask 约定。
 */
import { useEffect, useId, useRef, useState } from "react";

export interface MaskEditorProps {
  readonly referenceSrc: string;
  readonly onCancel: () => void;
  readonly onCommit: (dataUrl: string) => void;
}

const BRUSH_MIN = 8;
const BRUSH_MAX = 160;

export function MaskEditor({ referenceSrc, onCancel, onCommit }: MaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | undefined>(undefined);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | undefined>(undefined);
  const [brush, setBrush] = useState(48);
  const [erasing, setErasing] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const formId = useId();

  // 载入参考图，按它的原始宽高初始化画布
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setSize({ width: image.naturalWidth, height: image.naturalHeight });
      setReady(true);
    };
    image.src = referenceSrc;
    return () => {
      imageRef.current = undefined;
    };
  }, [referenceSrc]);

  function paint(point: { x: number; y: number }, isFirstPoint: boolean): void {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || !context) return;
    context.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    context.fillStyle = "#ffffff";
    context.beginPath();
    const previous = lastPoint.current;
    if (isFirstPoint || previous === undefined) {
      context.arc(point.x, point.y, brush / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      // 用线段 + round cap 连笔，快速移动也不会断成一串点
      context.lineWidth = brush;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = erasing ? "rgba(0,0,0,1)" : "#ffffff";
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    }
    lastPoint.current = point;
  }

  function toCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function clearMask(): void {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function commit(): void {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    onCommit(canvas.toDataURL("image/png"));
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal mask-modal" role="dialog" aria-modal="true" aria-label="编辑遮罩">
        <header className="modal__head">
          <h2>涂抹要重画的区域</h2>
          <button type="button" className="modal__close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal__body">
          <p className="field__hint">
            涂过的地方会被重画，没涂的地方保持原样。画笔大小 {brush}px，可用「擦除」修掉涂错的部分。
          </p>
          <div className="mask-canvas">
            <img src={referenceSrc} alt="" aria-hidden="true" />
            <canvas
              ref={canvasRef}
              width={size.width || 1024}
              height={size.height || 1024}
              className={`mask-canvas__layer ${erasing ? "is-erasing" : ""}`}
              aria-label={`遮罩画布${ready ? "" : "（载入中）"}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                drawing.current = true;
                lastPoint.current = undefined;
                paint(toCanvasPoint(event), true);
              }}
              onPointerMove={(event) => {
                if (!drawing.current) return;
                paint(toCanvasPoint(event), false);
              }}
              onPointerUp={() => {
                drawing.current = false;
                lastPoint.current = undefined;
              }}
              onPointerLeave={() => {
                drawing.current = false;
                lastPoint.current = undefined;
              }}
            />
          </div>
          <div className="mask-toolbar">
            <label className="mask-toolbar__brush">
              <span>画笔 {brush}px</span>
              <input
                type="range"
                min={BRUSH_MIN}
                max={BRUSH_MAX}
                step={4}
                value={brush}
                aria-label="画笔大小"
                onChange={(event) => setBrush(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              className={`button button--ghost ${erasing ? "is-active" : ""}`}
              aria-pressed={erasing}
              onClick={() => setErasing((current) => !current)}
            >
              擦除
            </button>
            <button type="button" className="button button--ghost" onClick={clearMask}>
              清空
            </button>
          </div>
        </div>
        <footer className="modal__foot" id={formId}>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="button button--primary" onClick={commit}>
            用这个遮罩
          </button>
        </footer>
      </div>
    </div>
  );
}
