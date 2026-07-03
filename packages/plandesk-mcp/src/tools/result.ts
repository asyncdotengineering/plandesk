export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function toolSuccess(key: string, value: unknown): ToolResult {
  return toolSuccessPayload({ [key]: value });
}

export function toolSuccessPayload(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function toolNotFound(): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: 'not_found' }) }],
    isError: true,
  };
}

export function toolInvalidArgument(message?: string): ToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: 'invalid_argument', ...(message ? { message } : {}) }),
      },
    ],
    isError: true,
  };
}
