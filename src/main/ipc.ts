/**
 * image:* IPC 的注册点。
 *
 * 每个 handler 都先确认发送者是本窗口的顶层 frame，再把原始参数交给 service 校验。
 * main 不信任 renderer，也不在 IPC 层做厂商协议相关的事。
 */
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { IMAGE_CHANNELS, IMAGE_CHANNEL_LIST } from "@shared/channels";
import type { ImageTaskEvent, Notification } from "@shared/image-generation";
import type { ImageGenerationService } from "./image-generation/service";

export interface ImageIpcBridge {
  readonly sendEvent: (event: ImageTaskEvent) => void;
  readonly sendNotification: (notification: Notification) => void;
  readonly dispose: () => void;
}

export function registerImageIpc(options: {
  readonly service: ImageGenerationService;
  readonly getWindowWebContents: () => WebContents | undefined;
}): ImageIpcBridge {
  const { service, getWindowWebContents } = options;

  const isTrustedSender = (event: IpcMainInvokeEvent): boolean => {
    const contents = getWindowWebContents();
    return contents !== undefined && event.sender === contents && event.senderFrame === contents.mainFrame;
  };

  /** main → renderer 的事件推送。只发往本应用窗口的顶层 frame。 */
  const send = (channel: string, payload: unknown) => {
    const contents = getWindowWebContents();
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  };

  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    if (!IMAGE_CHANNEL_LIST.includes(channel)) throw new Error(`未登记的 channel：${channel}`);
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        // 不返回具体原因，避免给不可信页面提供探测信息。
        throw new Error("unauthorized");
      }
      return handler(...args);
    });
  };

  handle(IMAGE_CHANNELS.bootstrap, () => service.getBootstrap());
  handle(IMAGE_CHANNELS.createJob, (input) => service.createJob(input));
  handle(IMAGE_CHANNELS.cancelJob, (jobId) => service.cancelJob(jobId));

  return {
    sendEvent: (event) => send(IMAGE_CHANNELS.taskEvent, event),
    sendNotification: (notification) => send(IMAGE_CHANNELS.notification, notification),
    dispose: () => {
      for (const channel of [IMAGE_CHANNELS.bootstrap, IMAGE_CHANNELS.createJob, IMAGE_CHANNELS.cancelJob]) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
