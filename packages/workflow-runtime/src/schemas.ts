export interface Schema<T = unknown> {
  name: string;
  parse(value: unknown): T;
}

export type FieldValidators<T extends object> = Partial<{ [Key in keyof T]: (value: unknown) => value is T[Key] }>;

export function objectSchema<T extends object>(name: string, requiredKeys: (keyof T)[], validators: FieldValidators<T> = {}): Schema<T> {
  return {
    name,
    parse(value: unknown): T {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
      const record = value as Record<string, unknown>;
      for (const key of requiredKeys) {
        if (!(key in record)) throw new Error(`${name} missing required key ${String(key)}`);
      }
      for (const [key, validator] of Object.entries(validators) as Array<[keyof T, (value: unknown) => boolean]>) {
        if (!(key in record)) continue;
        if (!validator(record[String(key)])) throw new Error(`${name}.${String(key)} is invalid`);
      }
      return value as T;
    }
  };
}
