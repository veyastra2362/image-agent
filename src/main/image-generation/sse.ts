/**
 * Server-Sent Events 解析。
 *
 * Responses API 的流是标准 SSE：`event: <名字>` + 若干 `data: <JSON>` 行，
 * 空行分隔一条消息，最后以 `data: [DONE]` 结束。这里只做"把字节流切成事件"，
 * 不懂业务字段——业务映射在 adapter 里。
 */

export interface SseEvent {
  /** event: 行给的名字；没写就是 undefined。 */
  readonly event?: string;
  /** 这条消息里所有 data 行拼起来的内容。 */
  readonly data: string;
}

/** 增量喂字节，吐出完整事件；不完整的一行留在缓冲区里等下一次。 */
export class SseParser {
  #buffer = "";
  #event: string | undefined;
  #data: string[] = [];

  push(chunk: string): SseEvent[] {
    this.#buffer += chunk;
    const events: SseEvent[] = [];
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const rawLine = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      this.#consume(line, events);
      newline = this.#buffer.indexOf("\n");
    }
    return events;
  }

  #consume(line: string, events: SseEvent[]): void {
    if (line === "") {
      // 空行 = 一条消息结束
      if (this.#data.length > 0 || this.#event !== undefined) {
        events.push({ ...(this.#event === undefined ? {} : { event: this.#event }), data: this.#data.join("\n") });
      }
      this.#event = undefined;
      this.#data = [];
      return;
    }
    if (line.startsWith(":")) return; // 注释/心跳
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const rawValue = colon === -1 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") this.#event = value;
    else if (field === "data") this.#data.push(value);
  }
}

/** 把一段完整文本切成事件（测试与一次性解析用）。 */
export function parseSse(text: string): SseEvent[] {
  return new SseParser().push(text);
}

export function isDoneSentinel(event: SseEvent): boolean {
  return event.data.trim() === "[DONE]";
}
