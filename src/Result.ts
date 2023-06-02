export type Success<T = undefined> = { value: T };
export type Fail = { name: string; message: string };
export type Result<T = undefined> = Success<T> | Fail;

export function done<T>(arg: { value: T }): Success<T>;
export function done(arg: { name?: string; message: string }): Fail;
export function done<T>(arg: any): Result<T> {
  if ("value" in arg) {
    return { value: arg.value } as Success<T>;
  } else {
    return { name: arg.name || "unidentified", message: arg.message } as Fail;
  }
}

export function success(): Success;
export function success<T>(value: T): Success<T>;
export function success<T>(arg?: T): Success<T> | Success<undefined> {
  if (arg === undefined) {
    return done({ value: undefined });
  } else {
    return done({ value: arg });
  }
}

export function fail(message: string, name?: string): Fail {
  return done({ message, name });
}

export function check<T>(result: Result<T>): result is Success<T> {
  return "value" in result;
}

export function call<A extends any[], R extends Promise<any>>(
  cb: (...args: A) => R,
  ...args: A
): Promise<Result<Awaited<R>>>;
export function call<A extends any[], R extends any>(cb: (...args: A) => R, ...args: A): Result<R>;
export function call<A extends any[]>(cb: (...args: A) => any, ...args: A): any {
  const tryCb = resultify(cb);
  return tryCb(...args);
}

/**
 * Decorating a function with this will make it return a Result.
 * A good practice is to prefix the resultified function with `try`.
 * @param cb
 */
export function resultify<A extends any[], R extends any>(
  cb: (...args: A) => Promise<R>
): (...args: A) => Promise<Result<Awaited<R>>>;
export function resultify<A extends any[], R extends any>(
  cb: (...args: A) => R
): (...args: A) => Result<R>;
export function resultify<A extends any[], R extends any>(
  cb: (...args: A) => R
): (...args: A) => any {
  return (...args: A) => {
    try {
      const result = cb(...args);
      if (result instanceof Promise) {
        return result
          .then((value) => success(value))
          .catch((error) => fail((error as Error).message));
      } else {
        return success(result);
      }
    } catch (error) {
      return fail((error as Error).message);
    }
  };
}

export function partition<T>(results: Result<T>[]): [Success<T>[], Fail[]] {
  const successes: Success<T>[] = [];
  const fails: Fail[] = [];
  for (const result of results) {
    if (check(result)) {
      successes.push(result);
    } else {
      fails.push(result);
    }
  }
  return [successes, fails];
}
