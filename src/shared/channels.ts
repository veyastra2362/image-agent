/** 本应用新增的所有 IPC channel。preload 按名字逐个暴露方法，不提供通用 invoke。 */
export const IMAGE_CHANNELS = {
  bootstrap: "image:bootstrap",
  createJob: "image:create-job",
  cancelJob: "image:cancel-job",
  uploadReference: "image:upload-reference",
  optimizePrompt: "image:optimize-prompt",
  taskEvent: "image:task-event",
  notification: "image:notification",
} as const;

export type ImageChannel = (typeof IMAGE_CHANNELS)[keyof typeof IMAGE_CHANNELS];

/** 运行时白名单，main 注册 handler 时断言 channel 来自这里。 */
export const IMAGE_CHANNEL_LIST: readonly string[] = Object.values(IMAGE_CHANNELS);
