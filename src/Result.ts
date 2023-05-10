export type Result = string | undefined;

export function success(): Result {
  return;
}

export function error(msg: string): Result {
  return msg;
}

export function run(cb: () => any): Result {
  try {
    cb();
    return success();
  } catch (e) {
    return error((e as Error).message);
  }
}

export async function runAsync(cb: () => Promise<any>): Promise<Result> {
  try {
    await cb();
    return success();
  } catch (e) {
    return error((e as Error).message);
  }
}

export function isSuccess(res: Result): res is undefined {
  return res === undefined;
}
