export function buildJsonPluginConfigSchema(jsonSchema: unknown) {
  return { jsonSchema };
}

export function definePluginEntry<T extends Record<string, unknown>>(entry: T): T {
  return entry;
}
