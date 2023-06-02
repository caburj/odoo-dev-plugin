import * as vscode from "vscode";

export function withProgress<A extends any[], R extends Promise<any>>(arg: {
  message: string;
  cb: (...args: A) => R;
}) {
  return (...args: A): Promise<Awaited<R>> => {
    return new Promise((resolve, reject) =>
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: arg.message });
          try {
            resolve(await arg.cb(...args));
          } catch (err) {
            reject(err);
          }
        }
      )
    );
  };
}

export function screamOnError<A extends any[], R extends any>(cb: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R | undefined> => {
    try {
      return await cb(...args);
    } catch (error) {
      await vscode.window.showErrorMessage((error as Error).message);
    }
  };
}
