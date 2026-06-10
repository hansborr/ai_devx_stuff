export function timeoutErrorMessage(message: string): boolean {
  return /timeout|timed out|SIGTERM|ETIMEDOUT/iu.test(message);
}

export function outputCapErrorMessage(message: string): boolean {
  return /maxBuffer|ERR_CHILD_PROCESS_STDIO_MAXBUFFER|stdout maxBuffer|\bENOBUFS\b/iu.test(message);
}
