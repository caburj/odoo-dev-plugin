export type None = undefined;
export type Some<T> = T;
export type Option<T> = None | Some<T>;

export function some<T>(value: T): Some<T> {
  return value;
}

export function none(): None {
  return undefined;
}

export function check<T>(option: Option<T>): option is Some<T> {
  return option !== undefined;
}

export function unwrap<T>(option: Option<T>): T {
  if (check(option)) {
    return option;
  } else {
    throw new Error("unwrap failed");
  }
}

export function unwrapOr<T>(option: Option<T>, defaultValue: T): T {
  if (check(option)) {
    return option;
  } else {
    return defaultValue;
  }
}

export function unwrapExpect<T>(option: Option<T>, message: string): T {
  if (check(option)) {
    return option;
  } else {
    throw new Error(message);
  }
}

export function map<T, R>(option: Option<T>, mapper: (value: T) => R): Option<R> {
  if (check(option)) {
    return some(mapper(option));
  } else {
    return none();
  }
}

export function process<T>(
  option: Option<T>,
  onSome: (value: T) => void,
  onNone: () => void
): void {
  if (check(option)) {
    onSome(option);
  } else {
    onNone();
  }
}

export function call<A extends any[], R>(cb: (...args: A) => R, ...args: A): Option<R> {
  try {
    return some(cb(...args));
  } catch (error) {
    return none();
  }
}

/**
 * Decorating a function with this will make it return an `Option`.
 * @param cb
 */
export function optionify<A extends any[], R>(
  cb: (...args: A) => Promise<R>
): (...args: A) => Promise<Option<Awaited<R>>>;
export function optionify<A extends any[], R>(
  cb: (...args: A) => R
): (...args: A) => Option<R>;
export function optionify<A extends any[], R>(cb: (...args: A) => R): (...args: A) => any {
  return (...args: A) => {
    try {
      const result = cb(...args);
      if (result instanceof Promise) {
        return result.then((value) => some(value)).catch(none);
      } else {
        return some(result);
      }
    } catch (error) {
      return none();
    }
  };
}
