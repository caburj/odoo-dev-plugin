export type Success<T = undefined> = { value: T };
export type Fail<E extends Error> = { error: E };
export type Result<T, E extends Error> = Success<T> | Fail<E>;

export function done<T>(arg: { value: T }): Success<T>;
export function done<E extends Error>(arg: { error: E }): Fail<E>;
export function done<T, E extends Error>(arg: any): Result<T, E> {
  if ("value" in arg) {
    return { value: arg.value } as Success<T>;
  } else {
    return { error: arg.error } as Fail<E>;
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

export function fail<E extends Error>(error: E): Fail<E> {
  return done({ error });
}

export function check<T, E extends Error>(result: Result<T, E>): result is Success<T> {
  return "value" in result;
}

export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (check(result)) {
    return result.value;
  } else {
    throw result.error;
  }
}

export function process<T, E extends Error>(
  result: Result<T, E>,
  onSuccess: (value: T) => void,
  onFail: (error: E) => void
): void {
  if (check(result)) {
    onSuccess(result.value);
  } else {
    onFail(result.error);
  }
}

export function try_<A extends any[], R extends Promise<any>, E extends Error>(
  cb: (...args: A) => R,
  ...args: A
): Promise<Result<Awaited<R>, E>>;
export function try_<A extends any[], R, E extends Error>(
  cb: (...args: A) => R,
  ...args: A
): Result<R, E>;
export function try_<A extends any[]>(cb: (...args: A) => any, ...args: A): any {
  const trycb = resultify(cb);
  return trycb(...args);
}

/**
 * Decorating a function with this will make it return a Result.
 * A good practice is to prefix the resultified function with `try`.
 * @param cb
 */
export function resultify<A extends any[], R, E extends Error>(
  cb: (...args: A) => Promise<R>
): (...args: A) => Promise<Result<Awaited<R>, E>>;
export function resultify<A extends any[], R, E extends Error>(
  cb: (...args: A) => R
): (...args: A) => Result<R, E>;
export function resultify<A extends any[], R>(cb: (...args: A) => R): (...args: A) => any {
  return (...args: A) => {
    try {
      const result = cb(...args);
      if (result instanceof Promise) {
        return result.then((value) => success(value)).catch((error) => fail(error));
      } else {
        return success(result);
      }
    } catch (error) {
      return fail(error as Error);
    }
  };
}

export function partition<T, E extends Error>(results: Result<T, E>[]): [Success<T>[], Fail<E>[]] {
  const successes: Success<T>[] = [];
  const fails: Fail<E>[] = [];
  for (const result of results) {
    if (check(result)) {
      successes.push(result);
    } else {
      fails.push(result);
    }
  }
  return [successes, fails];
}
