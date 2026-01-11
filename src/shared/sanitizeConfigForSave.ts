export const sanitizeConfigForSave = <T>(input: T): T => {
  const sanitize = (value: any): any => {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => sanitize(item))
        .filter((item) => item !== null && item !== undefined);
    }

    if (typeof value === 'object') {
      const result: Record<string, any> = {};
      Object.keys(value).forEach((key) => {
        result[key] = sanitize(value[key]);
      });
      return result;
    }

    return value;
  };

  return sanitize(input) as T;
};
