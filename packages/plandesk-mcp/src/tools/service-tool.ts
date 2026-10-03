import { toolNotFound, toolSuccess, toolSuccessPayload, type ToolResult } from './result.js';

export function serviceTool<A extends Record<string, unknown> = Record<string, unknown>>(
  call: (args: A) => Promise<unknown>,
  resultKey: string,
  mapValue?: (value: unknown) => unknown,
): (args: A) => Promise<ToolResult> {
  return async (args) => {
    const value = await call(args);
    if (!value) {
      return toolNotFound();
    }
    return toolSuccess(resultKey, mapValue ? mapValue(value) : value);
  };
}

export function serviceToolPayload<A extends Record<string, unknown> = Record<string, unknown>>(
  call: (args: A) => Promise<object | null | undefined | false>,
): (args: A) => Promise<ToolResult> {
  return async (args) => {
    const value = await call(args);
    if (!value) {
      return toolNotFound();
    }
    return toolSuccessPayload(value as Record<string, unknown>);
  };
}
